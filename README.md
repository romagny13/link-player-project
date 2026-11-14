# LinkPlayer

Turn plain links, code definitions or existing iframes into **YouTube** and **OK.ru** players, rendered in the container of your choice. Vanilla JS, ES modules, no framework, no DOM observer.

---

## Highlights

- **Three ways to declare videos**: HTML links, JavaScript definitions, or adopted `<iframe>`s.
- **Two providers**: YouTube (videos, video lists, playlists) and OK.ru (single videos), behind a common provider interface.
- **Smart iframe handling**: the iframe is rewritten only when the *info* changes (new video, new list, new playlist). Same info + another item = a single player command, no reload.
- **Regions**: each target container is a `Region` with one active item, a navigation journal (back / forward), a panel and dependent views.
- **Navigation before discovery**: navigating to a region whose container is not in the DOM yet is queued and replayed once the container is found.
- **Persistence**: optional storage of the last item per region.
- **Pluggable UI**: panel, items, header, toggle, groups and tooltip renderers can all be replaced.

---

## Quick start

```html
<a href="https://youtu.be/dQw4w9WgXcQ" data-target="player-a" data-title="Demo">Watch</a>
<div id="player-a"></div>

<script type="module">
  import {LinkPlayer} from "./LinkPlayer.js";

  const lp = new LinkPlayer();   // scans the document once
</script>
```

Clicking the link renders the player inside `#player-a`.

---

## Three usage modes

### 1. Links only

Every `<a>` with a supported URL is bound automatically. Configure it with `data-*` attributes (table below).

```html
<a href="https://www.youtube.com/watch?v=ID" data-target="main" data-start="1:30">Intro</a>
<a href="https://ok.ru/video/123456789"      data-target="main">OK.ru clip</a>
```

### 2. Code only

```js
const lp = new LinkPlayer({
  definitions: [
    {url: "https://youtu.be/ID", target: "main", title: "Intro", autoplay: "click"},
    {url: "https://www.youtube.com/watch?list=PLxxxx", target: "side", key: "my-playlist"}
  ]
});
lp.getRegion("main").navigate("youtube:ID");
```

### 3. Mixed

Definitions and links coexist. **A definition wins over a link with the same key.**

### Adopting an existing iframe

An iframe already in the page (YouTube embed or OK.ru `videoembed`) is parsed, its parent becomes the target container (an id `host:<uuid>` is generated if the parent has none) and the region *adopts* it without reloading.

---

## Link data attributes

| Attribute | Meaning |
|---|---|
| `data-target` | Target container id (falls back to `defaultTarget`) |
| `data-key` | Custom key (default derived from the URL) |
| `data-title`, `data-description` | Display texts |
| `data-channel`, `data-channel-url` | Channel name / link |
| `data-thumbnail` | Thumbnail URL |
| `data-duration`, `data-start` | Seconds, or `m:ss` / `h:mm:ss` |
| `data-autoplay` | `""`/`true`/`init` → on init, `click` → on click, `false` → none |
| `data-show-on-init` | Show this item when the page loads |
| `data-index` | Start index in a list or playlist |
| `data-videos` | JSON array describing the items of a list / playlist |
| `data-extra` | Free JSON payload kept on the info object |
| `data-url` | Override of the URL to parse |
| `[data-link]` | Marker to bind a non-`<a>` element |

`data-*` booleans follow one rule: attribute present, `""` or `"true"` → true; absent, `"false"`, `"0"`, `"no"` → false.

---

## Supported URLs

| Provider | Forms |
|---|---|
| YouTube | `youtu.be/ID`, `watch?v=`, `watch?list=` (`&v`, `&index`), `watch_videos?video_ids=…&index=`, `embed/ID`, `embed?playlist=`, `embed/videoseries?list=` |
| OK.ru | `/video/ID`, `/videoembed/ID`, legacy `?video_ids=…&labels=` (labels are split before decoding, `%2C` is a literal comma) |

### Keys

| Kind | Key |
|---|---|
| Video | `provider:videoId` |
| Video list | `provider:list:id1,id2` |
| Playlist | `provider:playlist:PLid` |
| Custom | whatever you pass as `key` / `data-key` |

---

## Options

```js
new LinkPlayer({ /* all optional */ })
```

| Option | Purpose |
|---|---|
| `scope` | Root element to scan (default `document`) |
| `definitions` | Array of code definitions |
| `autoScan` | Scan at construction (call `scan()` yourself otherwise) |
| `defaultTarget` | Target for links without `data-target` |
| `currentBehavior` | Click on the current item: `"toggle"`, `"skip"`, or re-navigate |
| `useStorage`, `store` | Persist `{key, index}` per region (`state:<target>`); `store` replaces the default storage |
| `scanEmbeds` | Also adopt existing iframes |
| `tooltip` | Enable / disable hover tooltips |
| `youtubeApiKey`, `youtubeMeta` | Resolve titles, channels, thumbnails via the YouTube Data API |
| `fallbackTitle` | Title used when nothing else is known |
| `okruEmbedBaseUrl` | Base URL of an OK.ru embed relay |
| `registry`, `regionHost` | Replace the provider registry / the discovery service |
| `panelRenderer`, `itemRenderer`, `headerRenderer`, `toggleRenderer`, `groupRenderer`, `tooltipRenderer`, `thumbnails` | UI injection points |
| `onChange`, `onState`, `onError` | Callbacks |

---

## Region API

```js
const region = lp.getRegion("main");
```

| Group | Methods |
|---|---|
| Navigate | `navigate(key, {autoplay, index})`, `replace(key)` |
| History | `goBack()`, `goForward()` |
| Between infos | `previousInfo()`, `nextInfo()` |
| Inside a list / playlist | `previousItem()`, `nextItem()`, `playAt(index)` |
| Visibility | `toggle()`, `show()`, `hide()` (hide only hides / pauses) |
| Wiring | `adopt(iframe, info)`, `register(container)`, `hasPending` |
| Dependent views | `registerDependentView(id, fn)`, `unregisterDependentView(id)` |
| Read | `current`, `currentIndex`, `isVisible`, `hasContainer`, `itemCount`, `infos`, `canGoBack`, `canGoForward`, `canGoPreviousInfo`, `canGoNextInfo`, `canGoPreviousItem`, `canGoNextItem` |
| Add | `add(info)` → boolean, `get(key)` |

### Events

| Event | Detail |
|---|---|
| `change` | `{region, reason, info, index, visible}` |
| `state` | player state changes |
| `error` | errors raised while navigating or rendering |

Dependent views are re-notified on every item change of the player, which makes it simple to keep external lists, counters or buttons in sync.

---

## Discovery without observer

`DefaultRegionHost` only **discovers and notifies**: links, target containers and frames. It never manages regions. It does not watch the DOM: after injecting new markup, call:

```js
lp.scan();
```

New targets resolve pending navigations; new links are bound; new iframes are adopted.

### Several instances

Create **scoped** `LinkPlayer`s (with `scope`) **before** the global one. Elements already claimed (`data-lp`) are skipped by the next instance.

---

## YouTube Data API and titles

With `youtubeApiKey`, missing titles, channels, durations and thumbnails are fetched and cached. Without it, thumbnails come from the standard YouTube URL pattern and titles fall back to `data-title`, then `fallbackTitle`.

---

## Project layout

```
src/
  LinkPlayer.js            facade + DefaultRegionHost
  Region.js                single active item, journal, panel, player
  models/                  VideoInfo, VideoListInfo, PlaylistInfo, UrlInfo, SrcInfo
  providers/               InfoParser (base) + youtube/ + okru/ (parser, builder, player)
  utils/helpers.js         toBoolean, toInt, toNumber, toAutoplayMode, AUTOPLAY_MODES …
demo/index.html            full demo page
tests/                     Vitest (helpers, models, parsers)
```

## Demo and tests

- **Demo**: open `demo/index.html`. It covers links-only, code-only and mixed modes, show-on-init, storage, `currentBehavior`, `defaultTarget`, YouTube Data API, `fallbackTitle`, dependent views, autoplay on click, iframe adoption, back / forward, previous / next info and item, and a scoped player without tooltip next to the global one.
- **Tests**: `npx vitest run`.

## Known limitations

- A per-item `start` inside a video list is parsed but not applied (lists are loaded with `startSeconds: 0`).
- Whether list indexes are 0- or 1-based on each provider has not been verified against the real players.
- OK.ru embeds support single videos only.
- `scan()` must be called again after dynamic DOM changes.