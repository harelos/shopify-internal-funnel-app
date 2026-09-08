!function() {
    "use strict";
    var runtimeScriptSource = document.currentScript && document.currentScript.src || "";
    function q(E) {
        if ("true" !== E.dataset.fceBooted) {
            var l;
            E.dataset.fceBooted = "true";
            try {
                l = JSON.parse(E.textContent || "{}");
            } catch (e) {
                return;
            }
            var A = "";
            if (L(), "loading" === document.readyState) {
                var W = new MutationObserver(L);
                W.observe(document.documentElement, {
                    childList: !0,
                    subtree: !0
                }), document.addEventListener("DOMContentLoaded", function() {
                    L(), W.disconnect();
                }, {
                    once: !0
                });
            }
        }
        function m() {
            !l.debug || !window.console || console.info.apply(console, [ "[Funnel Control]" ].concat(Array.prototype.slice.call(arguments)));
        }
        function _() {
            return window.crypto && "function" == typeof window.crypto.randomUUID ? window.crypto.randomUUID() : "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
        }
        function w(e, t) {
            try {
                return e.getItem(t) || "";
            } catch (a) {
                return "";
            }
        }
        function I(e, t, a) {
            try {
                e.setItem(t, a);
            } catch (n) {
                m("Browser storage unavailable; using page-scoped identity fallback");
            }
        }
        function k(e) {
            for (var t = e + "=", a = String(document.cookie || "").split(";"), n = 0; n < a.length; n += 1) {
                var i = a[n].trim();
                if (0 === i.indexOf(t)) return decodeURIComponent(i.slice(t.length));
            }
            return "";
        }
        function N() {
            return !(!window.posthog || "function" != typeof window.posthog.capture || "function" == typeof window.posthog.has_opted_out_capturing && window.posthog.has_opted_out_capturing());
        }
        function K(e, t) {
            N() && window.posthog.capture(e, Object.assign({
                event_id: _()
            }, t));
        }
        function x(e, t) {
            return l.labels && l.labels[e] || t;
        }
        function R(e) {
            return {
                experiment_id: e.experimentId,
                experiment_key: e.experimentKey,
                experiment_variant: e.variantKey,
                assignment_id: e.assignmentId,
                allocation_version: e.allocationVersion,
                slot_id: e.slotId,
                slot_key: e.slotKey,
                template_type: e.templateType,
                template_version: e.templateVersion,
                content_revision: e.contentRevision,
                page_id: l.pagePath,
                is_internal: !!l.isInternal
            };
        }
        function M(e, t) {
            var a = {
                visitorId: t,
                isInternal: !!l.isInternal,
                assignment: {
                assignmentId: e.assignmentId,
                experimentId: e.experimentId,
                variantId: e.variantId,
                slotId: e.slotId
                }
            };
            window.FunnelControlAttribution && "function" == typeof window.FunnelControlAttribution.persist ? window.FunnelControlAttribution.persist(a) : (window.__funnelControlAttributionQueue = window.__funnelControlAttributionQueue || [],
            window.__funnelControlAttributionQueue.push(a));
        }
        function Q(e, t) {
            if (l.isInternal) return Promise.resolve();
            var a = window.Shopify && window.Shopify.routes && window.Shopify.routes.root || "/", n = String(l.endpoint || "/apps/funnels").replace(/\/$/, "") + "/element-cart-attribution";
            return fetch(a + "cart.js", {
                credentials: "same-origin",
                headers: {
                    Accept: "application/json"
                }
            }).then(function(i) {
                if (!i.ok) throw new Error("cart_" + i.status);
                return i.json();
            }).then(function(i) {
                var o = String(i && i.token || "").split("?")[0];
                if (o) {
                    var g = "_fce_cart:" + o + ":" + e.experimentId + ":" + e.assignmentId;
                    if (!w(sessionStorage, g)) return fetch(n, {
                        method: "POST",
                        credentials: "same-origin",
                        keepalive: !0,
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json"
                        },
                        body: JSON.stringify({
                            cartToken: o,
                            visitorId: t,
                            elementAssignments: [ {
                                assignmentId: e.assignmentId,
                                experimentId: e.experimentId,
                                variantId: e.variantId,
                                slotId: e.slotId
                            } ]
                        })
                    }).then(function(v) {
                        if (!v.ok) throw new Error("cart_attribution_" + v.status);
                        I(sessionStorage, g, "1");
                    });
                }
            }).catch(function(i) {
                m("Cart attribution persistence failed", i.message);
            });
        }
        function b(e, t, a) {
            var n = R(e), i = "_fce_exposure:" + e.experimentKey + ":" + e.allocationVersion + ":" + e.variantKey;
            w(sessionStorage, i) || (I(sessionStorage, i, "1"), function(e, t, a) {
                var n = String(l.endpoint || "/apps/funnels").replace(/\/$/, "") + "/element-exposure";
                fetch(n, {
                    method: "POST",
                    credentials: "same-origin",
                    keepalive: !0,
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    body: JSON.stringify({
                        eventId: a,
                        visitorId: t,
                        assignmentId: e.assignmentId,
                        experimentId: e.experimentId,
                        variantId: e.variantId,
                        slotId: e.slotId,
                        isInternal: !!l.isInternal
                    })
                }).catch(function(i) {
                    m("Exposure persistence failed", i.message);
                });
            }(e, t, _()));
            var o = i + ":posthog";
            if (!w(sessionStorage, o)) {
                if (!N()) return void ((a || 0) < 40 && window.setTimeout(function() {
                    b(e, t, (a || 0) + 1);
                }, 250));
                M(e, t), I(sessionStorage, o, "1"), e.posthogFlagKey && window.posthog.capture("$feature_flag_called", Object.assign({
                    $feature_flag: e.posthogFlagKey,
                    $feature_flag_response: e.variantKey
                }, n)), K("experiment_exposed", n), window.dispatchEvent(new CustomEvent("funnel-control:experiment-exposed", {
                    detail: n
                }));
            }
        }
        function f(e, t, a, n, i) {
            K(t, Object.assign({}, R(e), {
                image_id: a.id,
                image_index: n + 1
            }, i || {}));
        }
        function D(e, t, a) {
            var n = t.payload || {};
            if (e.dataset.experimentKey = t.experimentKey, e.dataset.experimentVariant = t.variantKey, 
            e.dataset.assignmentId = t.assignmentId, t.isControl || n.preserveExisting) return e.dataset.fceReady = "true", 
            M(t, a), Q(t, a), b(t, a), !0;
            if (!Array.isArray(n.items) || 0 === n.items.length) return !1;
            var i = document.createElement("div");
            i.className = "fce-gallery", i.setAttribute("role", "region"), i.setAttribute("aria-label", x("gallery", "Product gallery"));
            var o = document.createElement("figure");
            o.className = "fce-gallery__stage";
            var g = document.createElement("img");
            g.className = "fce-gallery__image", g.decoding = "async", g.loading = "eager";
            var v = document.createElement("figcaption");
            v.className = "fce-gallery__caption", o.appendChild(g), o.appendChild(v);
            var h = document.createElement("div");
            h.className = "fce-gallery__thumbs", h.setAttribute("aria-label", x("images", "Gallery images"));
            var O = [], s = Math.max(0, Math.min(n.items.length - 1, Number(n.initialIndex) || 0)), u = 0;
            function S(p) {
                if (u) {
                    var r = Date.now() - u;
                    r >= 500 && f(t, "gallery_image_engaged", n.items[s], s, {
                        view_duration_ms: r,
                        interaction_source: p
                    }), u = 0;
                }
            }
            function C(p, r) {
                var d = (p + n.items.length) % n.items.length;
                u && S(r || "change"), s = d;
                var c = n.items[s];
                g.src = c.src, g.alt = c.alt, v.textContent = c.caption || "", v.hidden = !c.caption, 
                O.forEach(function(T, V) {
                    T.setAttribute("aria-current", V === s ? "true" : "false");
                }), u = Date.now(), f(t, "gallery_image_viewed", c, s, {
                    interaction_source: r || "initial"
                });
            }
            n.items.forEach(function(p, r) {
                var d = document.createElement("button");
                d.type = "button", d.className = "fce-gallery__thumb", d.setAttribute("aria-label", x("showImage", "Show image") + " " + (r + 1));
                var c = document.createElement("img");
                c.className = "fce-gallery__thumb-image", c.src = p.src, c.alt = "", c.loading = "lazy", 
                c.decoding = "async", d.appendChild(c), d.addEventListener("click", function() {
                    f(t, "gallery_thumbnail_clicked", p, r, {
                        interaction_type: "thumbnail"
                    }), C(r, "thumbnail");
                }), O.push(d), h.appendChild(d);
            });
            var y = null;
            return o.addEventListener("pointerdown", function(p) {
                y = p.clientX;
            }), o.addEventListener("pointerup", function(p) {
                if (null !== y) {
                    var r = p.clientX - y;
                    if (y = null, !(Math.abs(r) < 45)) {
                        var d = r < 0 ? s + 1 : s - 1;
                        f(t, "gallery_swiped", n.items[s], s, {
                            interaction_type: "swipe",
                            direction: r < 0 ? "left" : "right"
                        }), C(d, "swipe");
                    }
                }
            }), i.appendChild(o), !1 !== n.showThumbnails && i.appendChild(h), e.replaceChildren(i), 
            e.dataset.fceReady = "true", M(t, a), Q(t, a), b(t, a), C(s, "initial"), window.addEventListener("pagehide", function() {
                S("pagehide");
            }, {
                once: !0
            }), document.addEventListener("visibilitychange", function() {
                document.hidden ? S("hidden") : u || (u = Date.now());
            }), !0;
        }
        function P(e) {
            var t = e.getAttribute("data-funnel-slot");
            if (!t || "true" === e.dataset.fceLoading || "true" === e.dataset.fceReady) return Promise.resolve();
            e.dataset.fceLoading = "true";
            var a = String(l.endpoint || "/apps/funnels").replace(/\/$/, ""), n = function() {
                var e = "_fce_visitor", t = w(localStorage, e) || k(e) || A;
                if (t) return t;
                var a = _();
                A = a, I(localStorage, e, a);
                try {
                    document.cookie = e + "=" + encodeURIComponent(a) + "; Path=/; Max-Age=31536000; SameSite=Lax; Secure";
                } catch (n) {
                    m("Cookie storage unavailable");
                }
                return a;
            }(), selectionEndpoint = String(l.selectionEndpoint || "").replace(/\/$/, "");
            if (!selectionEndpoint && runtimeScriptSource) {
                var runtimeUrl = new URL(runtimeScriptSource);
                if ("shopify-funnel-control.tigerbrands-funnel.workers.dev" === runtimeUrl.hostname) selectionEndpoint = runtimeUrl.origin + "/apps/funnels/public";
            }
            var i = (selectionEndpoint || a) + "/element-runtime/" + encodeURIComponent(t) + "?page=" + encodeURIComponent(l.pagePath || window.location.pathname) + "&visitor_id=" + encodeURIComponent(n), o = !1, g = Math.max(400, Math.min(2e3, Number(l.revealTimeoutMs) || 1400)), v = window.setTimeout(function() {
                o = !0, e.dataset.fceReady = "true", e.dataset.fceFallback = "timeout", m("Control revealed after runtime timeout", t);
            }, g);
            function h(s) {
                o || (o = !0, window.clearTimeout(v), e.dataset.fceReady = "true", e.dataset.fceFallback = s);
            }
            return fetch(i, {
                credentials: selectionEndpoint ? "omit" : "same-origin"
            }).then(function(o) {
                if (!o.ok) throw new Error("runtime_" + o.status);
                return o.json();
            }).then(function(s) {
                if (!o) {
                    if (!s.active) return m("Inactive slot", t, s.reason), void h("inactive");
                    if ("GALLERY" === s.templateType) {
                        var u = s.payload || {}, S = !s.isControl && !u.preserveExisting && Array.isArray(u.items) && u.items[0] && u.items[0].src;
                        if (S) return function(e) {
                            return new Promise(function(t) {
                                if (e) {
                                    var a = new Image, n = !1;
                                    a.onload = function() {
                                        i(!0);
                                    }, a.onerror = function() {
                                        i(!1);
                                    }, a.src = e, a.complete && a.naturalWidth > 0 && i(!0);
                                } else t(!1);
                                function i(o) {
                                    n || (n = !0, a.onload = null, a.onerror = null, t(o));
                                }
                            });
                        }(S).then(function(C) {
                            o || (C ? (window.clearTimeout(v), D(e, s, n) || h("invalid_payload"), o = !0) : h("image_error"));
                        });
                        window.clearTimeout(v), D(e, s, n) || h("invalid_payload"), o = !0;
                    } else h("unsupported_template");
                }
            }).catch(function(s) {
                m("Control preserved after runtime failure", t, s.message), e.dataset.fceError = "true", 
                h("runtime_error");
            });
        }
        function L() {
            var e = Array.prototype.slice.call(document.querySelectorAll("[data-funnel-slot]")), t = Array.isArray(l.slots) ? l.slots : [], a = (l.pagePath || window.location.pathname || "").replace(/\/+$/, "") || "/";
            t.forEach(function(n) {
                if (n && n.slotKey && n.selector) {
                    var i = (n.pagePath || "").replace(/\/+$/, "") || "/";
                    if (!n.pagePath || i === a) {
                        var o;
                        try {
                            o = document.querySelector(n.selector);
                        } catch (g) {
                            return void m("Invalid slot selector", n.selector);
                        }
                        o && (o.hasAttribute("data-funnel-slot") || o.setAttribute("data-funnel-slot", n.slotKey), 
                        e.indexOf(o) < 0 && e.push(o));
                    }
                }
            }), e.forEach(P);
        }
    }
    function H() {
        var E = document.querySelector("[data-funnel-control-config]");
        return !!E && (q(E), !0);
    }
    if (!H() && document.documentElement) {
        var z = new MutationObserver(function() {
            H() && z.disconnect();
        });
        z.observe(document.documentElement, {
            childList: !0,
            subtree: !0
        }), document.addEventListener("DOMContentLoaded", function() {
            H(), z.disconnect();
        }, {
            once: !0
        });
    }
}();
