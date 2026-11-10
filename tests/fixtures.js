export const link = (url, dataset = {}) => ({
    tagName: "A",
    href: url,
    dataset: {target: "#player", ...dataset}
});

export const div = (url, dataset = {}) => ({
    tagName: "DIV",
    dataset: {target: "#player", url, ...dataset}
});