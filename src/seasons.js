const SEASON_RE =
    /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;

/** [{ label, start, end }] (end exclusive) or null when grouping is useless. */
export function groupBySeason(items, counts = null) {
    const n = items.length;
    if (counts?.length) {
        const groups = [];
        let start = 0;
        counts.forEach((c, i) => {
            if (start < n) {
                groups.push({
                    label: `Season ${i + 1}`,
                    start,
                    end: Math.min(start + c, n)
                });
                start += c;
            }
        });
        if (start < n) groups.push({ label: "Other", start, end: n });
        return groups.length > 1 ? groups : null;
    }
    const seasons = items.map((it) => {
        const m = SEASON_RE.exec(it.title);
        return m ? +(m[1] || m[2]) : null;
    });
    const first = seasons.find((s) => s !== null);
    if (first === undefined) return null;
    let cur = first > 1 ? 1 : null; // leading items without marker belong to season 1
    const groups = [];
    seasons.forEach((s, i) => {
        if (s !== null) cur = s;
        const last = groups[groups.length - 1];
        if (last && last.key === cur) last.end = i + 1;
        else
            groups.push({
                key: cur,
                label: cur === null ? "Other" : `Season ${cur}`,
                start: i,
                end: i + 1
            });
    });
    return groups.length > 1 ? groups : null;
}