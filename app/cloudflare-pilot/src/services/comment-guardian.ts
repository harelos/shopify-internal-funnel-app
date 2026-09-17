import { supportD1 } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { decideCommentAction } from "../lib/comment-intent.js";

/**
 * Answers and moderates the comments under the live Facebook and Instagram ads.
 *
 * This existed as a pair of scripts a person ran by hand, pasting a token into
 * stdin, which is why it asked for approval every single time and stopped
 * whenever nobody ran it. An earlier version on another branch only ever hid
 * comments to keep a positive-to-negative ratio, so it read 2,582 comments and
 * answered nobody. The tables and the Meta secrets were already here.
 *
 * It runs on the Worker's cron. Comments on a live ad are read by every future
 * buyer, so an unanswered "I ordered and it never came" costs more than the
 * order did.
 */
const GRAPH_VERSION = workerEnvValue("META_GRAPH_API_VERSION") || "v23.0";
const STATE_ID = "celestiva-limited-3";
const MAX_ACTIONS_PER_RUN = 25;
const MAX_SOURCES_PER_RUN = 25;

export interface CommentGuardianResult {
  mode: "shadow" | "live";
  checked: number;
  recommended: number;
  replied: number;
  hidden: number;
  escalated: number;
  errors: string[];
  skipped?: string;
  /** Only when explain is asked for: what it decided, and what it would post. */
  decisions?: Array<{ surface: string; commentId: string; comment: string; intent: string; action: string; reply: string | null }>;
}

interface GraphComment {
  id: string;
  message?: string;
  text?: string;
  from?: { id?: string; name?: string };
  username?: string;
  created_time?: string;
  timestamp?: string;
  is_hidden?: boolean;
  hidden?: boolean;
  comments?: { data?: Array<{ from?: { id?: string }; username?: string }> };
  replies?: { data?: Array<{ from?: { id?: string }; username?: string }> };
}

async function graph(path: string, params: Record<string, string>, token: string, method: "GET" | "POST" = "GET"): Promise<any> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) (method === "GET" ? url.searchParams : body).set(key, value);
  (method === "GET" ? url.searchParams : body).set("access_token", token);
  const response = await fetch(url, {
    method,
    headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(`${path}: ${String(payload?.error?.message || response.status).slice(0, 140)}`);
  return payload;
}

async function pagedGraph(path: string, params: Record<string, string>, token: string, maxPages = 3): Promise<any[]> {
  const rows: any[] = [];
  let payload = await graph(path, params, token);
  for (let page = 0; page < maxPages; page += 1) {
    rows.push(...(payload.data || []));
    if (!payload.paging?.next) break;
    const response = await fetch(payload.paging.next, { signal: AbortSignal.timeout(10000) });
    payload = await response.json().catch(() => ({}));
    if (payload?.error) break;
  }
  return rows;
}

/**
 * Facebook and Instagram disagree about every field name that matters here:
 * the text, the author, the hidden flag, and the endpoint a reply is posted to.
 */
interface Surface {
  name: "facebook" | "instagram";
  /** Whether this comment was written by the brand itself. */
  isSelf(comment: GraphComment): boolean;
  replyPath(commentId: string): string;
  hideParams: Record<string, string>;
}

export interface CommentGuardianOptions {
  /** Decide and record, but post nothing, whatever the configured mode says. */
  forceShadow?: boolean;
  /** Return the decisions themselves, for reading before they are ever sent. */
  explain?: boolean;
}

export async function processCommentGuardian(options: CommentGuardianOptions = {}): Promise<CommentGuardianResult> {
  const blank: CommentGuardianResult = { mode: "shadow", checked: 0, recommended: 0, replied: 0, hidden: 0, escalated: 0, errors: [] };
  if (workerEnvValue("COMMENT_GUARDIAN_ENABLED") !== "true") return { ...blank, skipped: "disabled" };
  // supportD1 throws rather than returning null when the binding is absent.
  let db: ReturnType<typeof supportD1>;
  try {
    db = supportD1();
  } catch {
    return { ...blank, skipped: "no_database" };
  }

  // The guardian's own token if one is set, otherwise the account token that
  // already carries pages_manage_engagement and the MODERATE task.
  // Either token is tried, because one of the two expiring independently is
  // otherwise enough to stop the whole thing silently.
  const candidateTokens = [workerEnvValue("COMMENT_GUARDIAN_META_TOKEN"), workerEnvValue("META_ACCESS_TOKEN")]
    .filter(Boolean).filter((token, index, all) => all.indexOf(token) === index);
  const pageId = workerEnvValue("COMMENT_GUARDIAN_PAGE_ID");
  const adAccount = workerEnvValue("COMMENT_GUARDIAN_AD_ACCOUNT_ID") || workerEnvValue("META_AD_ACCOUNT_ID");
  if (!candidateTokens.length || !pageId || !adAccount) return { ...blank, skipped: "not_configured" };

  const stateRow = await db.prepare('SELECT "mode" FROM "CommentGuardianState" WHERE "id" = ? LIMIT 1')
    .bind(STATE_ID).first<{ mode: string }>().catch(() => null);
  const configuredMode = (workerEnvValue("COMMENT_GUARDIAN_MODE") || stateRow?.mode || "shadow").toLowerCase();
  // The configured mode is what gets stored; forceShadow only suppresses this
  // one run, so a QA run can never leave the cron stuck in shadow.
  const persistedMode: "shadow" | "live" = configuredMode === "live" ? "live" : "shadow";
  const mode: "shadow" | "live" = persistedMode === "live" && !options.forceShadow ? "live" : "shadow";
  const result: CommentGuardianResult = { ...blank, mode };
  const startedAt = new Date().toISOString();
  let actions = 0;

  /**
   * What the guardian already did to these comments, in one query per batch
   * rather than one per comment: a busy ad would otherwise spend its whole
   * subrequest budget asking the same question eighty times.
   */
  type StoredRow = { executedAction: string | null; replyId: string | null };
  async function loadStored(ids: string[]): Promise<Map<string, StoredRow>> {
    const found = new Map<string, StoredRow>();
    for (let index = 0; index < ids.length; index += 80) {
      const chunk = ids.slice(index, index + 80);
      const rows = await db.prepare(
        `SELECT "commentId", "executedAction", "replyId" FROM "CommentGuardianComment"
         WHERE "commentId" IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk).all<{ commentId: string } & StoredRow>().catch(() => null);
      for (const row of rows?.results ?? []) found.set(row.commentId, row);
    }
    return found;
  }

  const pendingWrites: any[] = [];
  async function flushWrites(): Promise<void> {
    if (!pendingWrites.length) return;
    const batch = pendingWrites.splice(0, pendingWrites.length);
    await db.batch(batch).catch(() => undefined);
  }

  async function handleComment(surface: Surface, comment: GraphComment, sourceId: string, adId: string, token: string, stored: StoredRow | null): Promise<void> {
    result.checked += 1;
    const message = String(comment.message ?? comment.text ?? "");
    const replies = comment.comments?.data ?? comment.replies?.data ?? [];
    const decision = decideCommentAction({
      message,
      isFromPage: surface.isSelf(comment),
      // The brand having already answered is the strongest "leave it alone",
      // whether that answer came from this service or from a person.
      alreadyReplied: replies.some(reply => surface.isSelf(reply as GraphComment))
        || Boolean(stored?.replyId) || Boolean(stored?.executedAction),
    });

    if (options.explain && decision.action !== "IGNORE") {
      (result.decisions ??= []).push({
        surface: surface.name, commentId: comment.id, comment: message.slice(0, 160),
        intent: decision.intent, action: decision.action, reply: decision.reply,
      });
    }

    let executedAction: string | null = null;
    let replyId: string | null = stored?.replyId ?? null;
    let isHidden = comment.is_hidden === true || comment.hidden === true;

    if (decision.action === "ESCALATE") result.escalated += 1;
    const acts = decision.action === "REPLY" || decision.action === "REPLY_AND_HIDE" || decision.action === "HIDE";
    // A hidden comment is invisible to every reader, so there is no one left to
    // answer and nothing left to hide. Meta also refuses a reply to one, which
    // is what silently stopped the first live run: the old scripts had already
    // hidden exactly the comments worth answering.
    if (acts && isHidden) {
      executedAction = "ALREADY_HIDDEN";
    } else if (acts && (mode !== "live" || actions >= MAX_ACTIONS_PER_RUN)) {
      result.recommended += 1;
    } else if (acts) {
      try {
        if (decision.reply && decision.action !== "HIDE") {
          const posted = await graph(surface.replyPath(comment.id), { message: decision.reply }, token, "POST");
          replyId = String(posted.id || "");
          result.replied += 1;
          actions += 1;
        }
        if ((decision.action === "REPLY_AND_HIDE" || decision.action === "HIDE") && !isHidden) {
          await graph(comment.id, surface.hideParams, token, "POST");
          isHidden = true;
          result.hidden += 1;
          actions += 1;
        }
        executedAction = decision.action;
      } catch (error) {
        result.errors.push(`${comment.id}: ${String((error as Error).message).slice(0, 120)}`);
      }
    }

    pendingWrites.push(db.prepare(`INSERT INTO "CommentGuardianComment"
        ("commentId","adId","storyId","createdAt","message","classification","isHidden","recommendedAction","executedAction","replyId","firstSeenAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT("commentId") DO UPDATE SET
        "classification" = excluded."classification", "isHidden" = excluded."isHidden",
        "recommendedAction" = excluded."recommendedAction",
        "executedAction" = COALESCE(excluded."executedAction", "CommentGuardianComment"."executedAction"),
        "replyId" = COALESCE(excluded."replyId", "CommentGuardianComment"."replyId"),
        "updatedAt" = CURRENT_TIMESTAMP`)
      .bind(comment.id, adId, sourceId, comment.created_time ?? comment.timestamp ?? null, message.slice(0, 1000),
        decision.classification, isHidden ? 1 : 0, `${decision.intent}:${decision.action}`, executedAction, replyId));
  }

  try {
    // A page token is what may hide and reply; the user token only fetches it.
    let pageToken = "";
    let userToken = "";
    const tokenErrors: string[] = [];
    for (const candidate of candidateTokens) {
      try {
        const pages = await graph("me/accounts", { fields: "id,access_token", limit: "100" }, candidate);
        const page = (pages.data || []).find((item: any) => String(item.id) === pageId);
        if (page?.access_token) {
          pageToken = page.access_token;
          userToken = candidate;
          break;
        }
        tokenErrors.push(`page ${pageId} is not on this token's account`);
      } catch (error) {
        tokenErrors.push(String((error as Error).message).slice(0, 80));
      }
    }
    if (!pageToken) throw new Error(`No Meta token could reach the page: ${tokenErrors.join("; ").slice(0, 180)}`);

    const ads = await pagedGraph(`${adAccount}/ads`, {
      fields: "id,creative{effective_object_story_id,object_story_id,effective_instagram_media_id}",
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]),
      limit: "100",
    }, userToken);

    const storyToAds = new Map<string, string[]>();
    const mediaToAds = new Map<string, string[]>();
    for (const ad of ads) {
      const story = ad.creative?.effective_object_story_id || ad.creative?.object_story_id;
      if (story) {
        if (!storyToAds.has(story)) storyToAds.set(story, []);
        storyToAds.get(story)!.push(String(ad.id));
      }
      // The ad's own Instagram media id. Matching the account's media by
      // permalink instead finds nothing: an ad's Instagram post is a dark post
      // and never appears in the account's own media list.
      const media = String(ad.creative?.effective_instagram_media_id || "");
      if (media) {
        if (!mediaToAds.has(media)) mediaToAds.set(media, []);
        mediaToAds.get(media)!.push(String(ad.id));
      }
    }

    const facebook: Surface = {
      name: "facebook",
      isSelf: comment => String(comment.from?.id || "") === pageId,
      replyPath: commentId => `${commentId}/comments`,
      hideParams: { is_hidden: "true" },
    };

    for (const [storyId, adIds] of [...storyToAds.entries()].slice(0, MAX_SOURCES_PER_RUN)) {
      try {
        const comments = await pagedGraph(`${storyId}/comments`, {
          fields: "id,message,from{id,name},created_time,is_hidden,comments.limit(50){id,message,from{id}}",
          filter: "stream",
          order: "reverse_chronological",
          limit: "100",
        }, pageToken) as GraphComment[];
        const stored = await loadStored(comments.map(comment => comment.id));
        for (const comment of comments) {
          await handleComment(facebook, comment, storyId, adIds[0] || storyId, pageToken, stored.get(comment.id) ?? null);
        }
        await flushWrites();
      } catch (error) {
        result.errors.push(`fb ${storyId}: ${String((error as Error).message).slice(0, 140)}`);
      }
    }

    // Instagram, for the same ads. A different token scope, different field
    // names and a different reply endpoint, but the same decision.
    if (mediaToAds.size) {
      // Needed only so the brand's own replies are recognised as answers.
      const instagramUser = await graph(pageId, { fields: "instagram_business_account{username}" }, pageToken)
        .then(linked => String(linked?.instagram_business_account?.username || ""))
        .catch(() => "");
      const instagram: Surface = {
        name: "instagram",
        isSelf: comment => Boolean(instagramUser) && String(comment.username || "") === instagramUser,
        replyPath: commentId => `${commentId}/replies`,
        hideParams: { hide: "true" },
      };
      for (const [mediaId, adIds] of [...mediaToAds.entries()].slice(0, MAX_SOURCES_PER_RUN)) {
        try {
          const comments = await pagedGraph(`${mediaId}/comments`, {
            fields: "id,text,username,timestamp,hidden,replies.limit(50){id,text,username}",
            limit: "100",
          }, pageToken) as GraphComment[];
          if (!comments.length) continue;
          const stored = await loadStored(comments.map(comment => comment.id));
          for (const comment of comments) {
            await handleComment(instagram, comment, mediaId, adIds[0] || mediaId, pageToken, stored.get(comment.id) ?? null);
          }
          await flushWrites();
        } catch (error) {
          result.errors.push(`ig ${mediaId}: ${String((error as Error).message).slice(0, 140)}`);
        }
      }
    }

    await db.prepare(`INSERT INTO "CommentGuardianState"
        ("id","mode","lastRunAt","lastSuccessAt","lastError","checkedComments","shadowActions","liveReplies","liveHides","updatedAt")
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT("id") DO UPDATE SET
        "mode" = excluded."mode", "lastRunAt" = excluded."lastRunAt", "lastSuccessAt" = excluded."lastSuccessAt",
        "lastError" = excluded."lastError",
        "checkedComments" = "CommentGuardianState"."checkedComments" + excluded."checkedComments",
        "shadowActions" = "CommentGuardianState"."shadowActions" + excluded."shadowActions",
        "liveReplies" = "CommentGuardianState"."liveReplies" + excluded."liveReplies",
        "liveHides" = "CommentGuardianState"."liveHides" + excluded."liveHides",
        "updatedAt" = CURRENT_TIMESTAMP`)
      // A run that reached the end but could not post is not a success worth
      // hiding: the first live run failed three replies and left no trace.
      .bind(STATE_ID, persistedMode, startedAt, new Date().toISOString(),
        result.errors.length ? result.errors.join(" | ").slice(0, 400) : null,
        result.checked, result.recommended, result.replied, result.hidden)
      .run().catch(() => undefined);

    return result;
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 240);
    await db.prepare(`INSERT INTO "CommentGuardianState" ("id","mode","lastRunAt","lastError","checkedComments","shadowActions","liveReplies","liveHides","updatedAt")
      VALUES (?,?,?,?,0,0,0,0,CURRENT_TIMESTAMP)
      ON CONFLICT("id") DO UPDATE SET "lastRunAt" = excluded."lastRunAt", "lastError" = excluded."lastError", "updatedAt" = CURRENT_TIMESTAMP`)
      .bind(STATE_ID, persistedMode, startedAt, message).run().catch(() => undefined);
    result.errors.push(message);
    return result;
  }
}
