!function() {
    "use strict";
    var COOKIE = "_funnel_context", ATTRIBUTE = "__funnel_context__";
    function text(value, maxLength) {
        if ("string" != typeof value && "number" != typeof value) return "";
        return String(value).trim().slice(0, maxLength);
    }
    function readCookie(name) {
        for (var prefix = name + "=", parts = String(document.cookie || "").split(";"), index = 0; index < parts.length; index += 1) {
            var part = parts[index].trim();
            if (0 === part.indexOf(prefix)) return decodeURIComponent(part.slice(prefix.length));
        }
        return "";
    }
    function storageGet(key) {
        try { return sessionStorage.getItem(key) || ""; } catch (_) { return ""; }
    }
    function storageSet(key, value) {
        try { sessionStorage.setItem(key, value); } catch (_) {}
    }
    function currentTouch() {
        var query = new URLSearchParams(window.location.search || ""), touch = {
            landingPath: text(window.location.pathname || "/", 160)
        }, fields = {
            utm_source: [ "utmSource", 50 ],
            utm_medium: [ "utmMedium", 50 ],
            utm_campaign: [ "utmCampaign", 100 ],
            utm_content: [ "utmContent", 100 ],
            utm_term: [ "utmTerm", 80 ],
            campaign_id: [ "campaignId", 80 ],
            adset_id: [ "adsetId", 80 ],
            ad_id: [ "adId", 80 ],
            fbclid: [ "fbclid", 180 ],
            gclid: [ "gclid", 180 ]
        };
        Object.keys(fields).forEach(function(key) {
            var value = text(query.get(key), fields[key][1]);
            if (value) touch[fields[key][0]] = value;
        });
        try {
            if (document.referrer) touch.referrerHost = text(new URL(document.referrer).hostname, 100);
        } catch (_) {}
        return touch;
    }
    function hasCampaign(touch) {
        return !!(touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.utmContent || touch.utmTerm || touch.campaignId || touch.adsetId || touch.adId || touch.fbclid || touch.gclid);
    }
    function compactTouch(touch, lastTouch) {
        if (!touch || "object" != typeof touch) return {};
        var result = {}, limits = {
            utmSource: 50, utmMedium: 50, utmCampaign: 100, utmContent: 100,
            utmTerm: lastTouch ? 0 : 80, campaignId: 80, adsetId: 80, adId: 80,
            fbclid: 180, gclid: 180, landingPath: lastTouch ? 0 : 160,
            referrerHost: lastTouch ? 0 : 100
        };
        Object.keys(limits).forEach(function(key) {
            var value = limits[key] ? text(touch[key], limits[key]) : "";
            if (value) result[key] = value;
        });
        return result;
    }
    function hash(value) {
        for (var output = 0, index = 0; index < value.length; index += 1) {
            output = (output << 5) - output + value.charCodeAt(index);
            output |= 0;
        }
        return Math.abs(output).toString(36);
    }
    function posthogIdentity(context) {
        try {
            if (window.posthog && "function" == typeof window.posthog.get_distinct_id) {
                context.posthogDistinctId = text(window.posthog.get_distinct_id(), 180);
            }
            if (window.posthog && "function" == typeof window.posthog.get_session_id) {
                context.posthogSessionId = text(window.posthog.get_session_id(), 180);
            }
        } catch (_) {}
    }
    function persistCartContext(context) {
        var first = compactTouch(context.firstTouch, !1), last = compactTouch(context.lastTouch, !0), checkoutContext = {
            version: 1,
            visitorId: text(context.visitorId, 180),
            firstTouch: first,
            posthogDistinctId: text(context.posthogDistinctId, 180),
            posthogSessionId: text(context.posthogSessionId, 180),
            isInternal: !!context.isInternal
        };
        if (JSON.stringify(compactTouch(context.firstTouch, !0)) !== JSON.stringify(last) && Object.keys(last).length) {
            checkoutContext.lastTouch = last;
        }
        var value = JSON.stringify(checkoutContext), root = window.Shopify && window.Shopify.routes && window.Shopify.routes.root || "/";
        fetch(root + "cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function(response) {
            if (!response.ok) throw new Error("cart_" + response.status);
            return response.json();
        }).then(function(cart) {
            var cartToken = String(cart && cart.token || "").split("?")[0], key = "_fce_checkout_context:" + cartToken + ":" + hash(value);
            if (!cartToken || storageGet(key)) return;
            var attributes = {};
            attributes[ATTRIBUTE] = value;
            return fetch(root + "cart/update.js", {
                method: "POST",
                credentials: "same-origin",
                keepalive: !0,
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ attributes: attributes })
            }).then(function(response) {
                if (!response.ok) throw new Error("cart_context_" + response.status);
                storageSet(key, "1");
            });
        }).catch(function() {});
    }
    function persist(detail) {
        var context = {};
        try { context = JSON.parse(readCookie(COOKIE) || "{}"); } catch (_) {}
        var touch = currentTouch();
        if (!context.firstTouch) context.firstTouch = touch;
        if (hasCampaign(touch) || !context.lastTouch) context.lastTouch = touch;
        context.firstTouch = compactTouch(context.firstTouch, !1);
        context.lastTouch = compactTouch(context.lastTouch, !0);
        context.visitorId = text(detail && detail.visitorId, 180) || text(context.visitorId, 180);
        context.isInternal = !!context.isInternal || !!(detail && detail.isInternal) || "1" === new URLSearchParams(window.location.search || "").get("funnel_pixel_qa") || "1" === new URLSearchParams(window.location.search || "").get("funnel_internal");
        var assignments = Array.isArray(context.elementAssignments) ? context.elementAssignments : [], assignment = detail && detail.assignment;
        if (assignment && assignment.experimentId) {
            assignments = assignments.filter(function(item) { return item && item.experimentId !== assignment.experimentId; });
            assignments.push({
                assignmentId: text(assignment.assignmentId, 180),
                experimentId: text(assignment.experimentId, 180),
                variantId: text(assignment.variantId, 180),
                slotId: text(assignment.slotId, 180)
            });
        }
        context.elementAssignments = assignments.slice(-8);
        var hadPosthogIdentity = !!context.posthogDistinctId;
        posthogIdentity(context);
        var serialized = JSON.stringify(context);
        if (serialized.length > 3600) {
            context.elementAssignments = assignments.slice(-3);
            delete context.lastTouch;
            serialized = JSON.stringify(context);
        }
        try {
            document.cookie = COOKIE + "=" + encodeURIComponent(serialized) + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure";
        } catch (_) {}
        var retryAttempt = Number(detail && detail.retryAttempt) || 0;
        if (!retryAttempt || !hadPosthogIdentity && context.posthogDistinctId) persistCartContext(context);
        if (!context.posthogDistinctId && retryAttempt < 20) {
            window.setTimeout(function() {
                persist(Object.assign({}, detail, { retryAttempt: retryAttempt + 1 }));
            }, 250);
        }
    }
    window.FunnelControlAttribution = { persist: persist };
    var queued = Array.isArray(window.__funnelControlAttributionQueue) ? window.__funnelControlAttributionQueue.splice(0) : [];
    queued.forEach(persist);
}();
