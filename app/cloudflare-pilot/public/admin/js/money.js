/**
 * One way to show money on every Commerce OS screen.
 *
 * The store charges in shekels and Meta bills in dollars, so the dashboard
 * restates everything in one reporting currency. A converted number is only
 * trustworthy if the reader can see what it was converted from and at which
 * rate, so every amount carries that on hover rather than in a footnote
 * nobody reads.
 */
(function () {
  const formatters = new Map();

  function format(amount, currency) {
    if (amount == null || !Number.isFinite(Number(amount))) return null;
    const code = currency || "USD";
    if (!formatters.has(code)) {
      try {
        formatters.set(code, new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 2 }));
      } catch {
        formatters.set(code, { format: value => `${Number(value).toFixed(2)} ${code}` });
      }
    }
    return formatters.get(code).format(Number(amount));
  }

  /**
   * Describes a conversion in words, or returns null when the amount was
   * already in the reporting currency and nothing was converted.
   */
  function conversionTitle(conversion) {
    if (!conversion || conversion.rate == null) return null;
    const original = format(conversion.originalAmount, conversion.originalCurrency);
    const rate = `1 ${conversion.originalCurrency} = ${Number(conversion.rate).toPrecision(6)} ${conversion.quoteCurrency || "USD"}`;
    const published = conversion.rateDate
      ? ` published ${conversion.rateDate}${conversion.rateSource ? ` by ${conversion.rateSource}` : ""}`
      : "";
    const caveat = conversion.rateQuality && conversion.rateQuality !== "ACTUAL"
      ? ` Rate quality: ${conversion.rateQuality}.`
      : "";
    return `${original} converted at ${rate}${published}.${caveat} Shopify pays out in ${conversion.originalCurrency}, so this uses that day's published rate and is not a bank balance.`;
  }

  /** Attaches the conversion explanation to an element, or clears a stale one. */
  function explain(node, conversion) {
    if (!node) return;
    const title = conversionTitle(conversion);
    if (title) {
      node.setAttribute("title", title);
      node.dataset.converted = "true";
    } else {
      node.removeAttribute("title");
      delete node.dataset.converted;
    }
  }

  /** Builds the conversion record for an amount restated from a rate list. */
  function conversionFrom(rates, originalAmount, originalCurrency, quoteCurrency) {
    if (originalAmount == null || !originalCurrency || !Array.isArray(rates)) return null;
    const quote = rates.find(rate => String(rate.base).toUpperCase() === String(originalCurrency).toUpperCase());
    if (!quote || quote.rate == null) return null;
    return {
      originalAmount,
      originalCurrency: String(originalCurrency).toUpperCase(),
      quoteCurrency: quoteCurrency || quote.quote,
      rate: quote.rate,
      rateDate: quote.rateDate,
      rateSource: quote.source,
      rateQuality: quote.quality,
    };
  }

  window.Money = { format, conversionTitle, explain, conversionFrom };
})();
