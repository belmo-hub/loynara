const MAX_CENTS = 100_000_000;
export function parseMoney(raw) {
    let v = raw.trim();
    if (!v)
        return null;
    if (v.includes(',')) {
        if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(v))
            throw new Error('Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben.');
        v = v.replaceAll('.', '').replace(',', '.');
    }
    else if (!/^-?\d+(?:\.\d{1,2})?$/.test(v))
        throw new Error('Bitte einen Betrag eingeben, zum Beispiel 8,50.');
    const cents = Math.round(Number(v) * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS)
        throw new Error('Bitte höchstens 1.000.000 € eingeben.');
    return cents;
}
export function calculate(f, m, b, h, n, r) {
    for (const cost of [f, b, h, r])
        if (cost !== null && (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_CENTS))
            throw new Error('Kosten und Umsatz dürfen nicht negativ sein.');
    if (m !== null && (!Number.isSafeInteger(m) || Math.abs(m) > MAX_CENTS))
        throw new Error('Ungültiger Besuchsbeitrag.');
    if (n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 100000))
        throw new Error('Bitte 0 bis 100.000 ganze zusätzliche Besuche eingeben.');
    const complete = b !== null && h !== null, cost = f + (b ?? 0) + (h ?? 0);
    return { complete, cost, required: m !== null && m > 0 ? Math.ceil(cost / m) : null, change: complete && m !== null && n !== null ? n * m - cost : null, revenue: n !== null && r !== null ? n * r : null };
}
