// src/index.js
// Public API of the library. What is not exported here is internal and may move without notice.

export { LinkPlayer } from "./LinkPlayer.js";

// ── Navigation state (useful for types, instanceof, writing behaviors) ──
export { Region } from "./core/Region.js";

// ── Providers: add a platform ──
export { MediaProvider } from "./providers/MediaProvider.js";
export { ProviderRegistry } from "./providers/ProviderRegistry.js";
export { InfoParser } from "./providers/InfoParser.js";
export { IframeFactory } from "./providers/IframeFactory.js";
export { YouTubeProvider } from "./providers/youtube/YouTubeProvider.js";
export { OkruProvider } from "./providers/okru/OkruProvider.js";

// ── YouTube metadata (your own resolver can reuse them) ──
export { YouTubeMetaResolver } from "./providers/youtube/YouTubeMetaResolver.js";
export { YouTubeDataApi } from "./providers/youtube/YouTubeDataApi.js";

// ── Models: what a provider returns and what hooks receive ──
export { VideoInfo } from "./models/VideoInfo.js";
export { VideoListInfo } from "./models/VideoListInfo.js";
export { PlaylistInfo } from "./models/PlaylistInfo.js";
export { UrlInfo, SrcInfo } from "./models/UrlInfo.js";

// ── Views: one player, and how it sits in the container ──
export { MediaView } from "./views/MediaView.js";
export { ContentAdapter } from "./views/adapters/ContentAdapter.js";
export { SingleActiveAdapter } from "./views/adapters/SingleActiveAdapter.js";

// ── Behaviors: the ones LinkPlayer plugs in (use them as examples for your own) ──
export { ActiveLinkBehavior } from "./behaviors/ActiveLinkBehavior.js";
export { FormatBehavior } from "./behaviors/FormatBehavior.js";
export { MetaBehavior } from "./behaviors/MetaBehavior.js";
export { MuteBehavior } from "./behaviors/MuteBehavior.js";
export { PanelBehavior } from "./behaviors/PanelBehavior.js";
export { PersistenceBehavior } from "./behaviors/PersistenceBehavior.js";

// ── Metadata ──
export { MetaService } from "./meta/MetaService.js";
export { applyItems, applyDefinition } from "./meta/metaMerge.js";

// ── Page discovery (replaceable through the `regionHost` option) ──
export { RegionHost } from "./page/RegionHost.js";

// ── UI: every piece of the panel and the tooltip can be replaced or extended ──
export { PanelRenderer } from "./ui/panel/PanelRenderer.js";
export { ItemRenderer } from "./ui/panel/ItemRenderer.js";
export { HeaderRenderer } from "./ui/panel/HeaderRenderer.js";
export { ToggleRenderer } from "./ui/panel/ToggleRenderer.js";
export { GroupRenderer } from "./ui/panel/GroupRenderer.js";
export { groupBySeason } from "./ui/panel/groupBySeason.js";
export { ThumbnailService } from "./ui/ThumbnailService.js";
export { Tooltip } from "./ui/tooltip/Tooltip.js";
export { TooltipRenderer } from "./ui/tooltip/TooltipRenderer.js";

// ── Utilities ──
export { Emitter } from "./utils/Emitter.js";
export { MemoryStore, JsonStore, defaultStore } from "./utils/storage.js";
export { AUTOPLAY_MODES, FORMATS, SOURCE_KINDS } from "./utils/helpers.js";