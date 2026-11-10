import {ValueChecks} from "../../utils/ValueChecks.js";

export class YouTubeThumbnailUrlBuilder {
    static #BASE_URL = 'https://i.ytimg.com/vi';

    getThumbnailUrl(videoId) {
        ValueChecks.requireNotNullOrEmpty(videoId, "videoId");
        return `${YouTubeThumbnailUrlBuilder.#BASE_URL}/${videoId}/mqdefault.jpg`;
    }
}