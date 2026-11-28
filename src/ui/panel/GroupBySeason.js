
export const SEASON_RE =
    /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;


/**
 * Splits the items into seasons: [{ label, start, end }] (end exclusive), or null when grouping is useless.
 * @param {Array} items Items with `item.title`.
 * @param {number[]|null} counts Explicit number of items per season; when absent, "Season 2" / "S02E05" are read from the titles.
 */
export function groupBySeason(items, counts = null) {
    const n = items.length;
    if (counts?.length) {
        const groups = [];
        let start = 0;
        counts.forEach((count, i) => {
            if (start < n) {
                groups.push({
                    label: `Season ${i + 1}`,
                    start,
                    end: Math.min(start + count, n)
                });
                start += count;
            }
        });
        if (start < n) groups.push({label: "Other", start, end: n});
        return groups.length > 1 ? groups : null;
    }

    const seasons = items.map((item) => {
        const match = SEASON_RE.exec(item.title ?? "");
        return match ? +(match[1] || match[2]) : null;
    });
    const first = seasons.find((season) => season !== null);
    if (first === undefined) return null;

    let current = first > 1 ? 1 : null; // leading items without a marker belong to season 1
    const groups = [];
    seasons.forEach((season, i) => {
        if (season !== null) current = season;
        const last = groups[groups.length - 1];
        if (last && last.key === current) last.end = i + 1;
        else
            groups.push({
                key: current,
                label: current === null ? "Other" : `Season ${current}`,
                start: i,
                end: i + 1
            });
    });
    return groups.length > 1 ? groups : null;
}