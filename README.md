# LinkPlayer

Turn plain links, code definitions or existing iframes into **YouTube** and **OK.ru** players, rendered in the container of your choice. Vanilla JS, ES modules, no framework, no DOM observer.

---

## Highlights

- **Three ways to declare videos**: HTML links, JavaScript definitions, or adopted `<iframe>`s.
- **Two providers**: YouTube (videos, video lists, playlists) and OK.ru (videos and video lists), behind a common provider interface.
- **Smart iframe handling**: the iframe is rewritten only when the *info* changes (new video, new list, new playlist). Same info + another item = a single player command, no reload.
- **Regions**: each target container is a `Region` with one active item, a navigation journal (back / forward), a panel and after-navigation hooks.
- **Navigation before discovery**: actions on a region whose container is not in the DOM yet are queued and replayed, in order, once the container is found.
- **Facade on `LinkPlayer`**: `lp.navigate("main", key)`, `lp.nextItem("main")`... every common action by target id.
- **Persistence**: optional storage of the last item per region.
- **Pluggable UI**: panel, items, header, toggle, groups and tooltip renderers can all be replaced.

---

## Install and build

```
npm run build
```

writes to `dist/` (see `vite.config.js`):

| File | Format |
|---|---|
| `link-player.es.js` | ES module |
| `link-player.js` | UMD, readable |
| `link-player.min.js` | UMD, minified |

Each one comes with a source map. The UMD builds expose a global `LinkPlayer`:

```html
<script src="dist/link-player.min.js"></script>
<script>new LinkPlayer();</script>
```

With ES modules, import the source directly: `import {LinkPlayer} from "./src/LinkPlayer.js"`.

---

## Quick start

```html
<a href="https://youtu.be/dQw4w9WgXcQ" data-link data-target="player-a" data-title="Demo">Watch</a>
<div id="player-a"></div>

<script type="module">
  import {LinkPlayer} from "./src/LinkPlayer.js";

  const lp = new LinkPlayer();   // scans the document once
</script>
```

Clicking the link renders the player inside `#player-a`. Without JavaScript the link still opens the video page: the click is only intercepted once the link is bound.

> Serve the page over `http(s)` (for example `npx vite`). ES modules do not load from `file://`, and the YouTube player needs a real page origin.

---

## Three usage modes

### 1. Links only

Every element marked `data-link` is bound. Configure it with `data-*` attributes (table below).

```html
<a href="https://www.youtube.com/watch?v=ID" data-link data-target="main" data-start="1m30s">Intro</a>
<a href="https://ok.ru/video/123456789"      data-link data-target="main">OK.ru clip</a>
```

### 2. Code only

```js
const lp = new LinkPlayer({
  definitions: [
    {url: "https://youtu.be/ID", target: "main", title: "Intro", autoplay: "click"},
    {url: "https://www.youtube.com/watch?list=PLxxxx", target: "side", key: "my-playlist"}
  ]
});
lp.navigate("main", "youtube:ID");
```

### 3. Mixed

Definitions and links coexist. **A definition wins over a link with the same key** (the link then drives the definition's info).

### Adopting an existing iframe

An iframe already in the page (YouTube `embed` or OK.ru `videoembed`) is parsed, its parent becomes the target container (an id `host:<uuid>` is generated if the parent has none) and the region *adopts* it. Needs `scanEmbeds: true` (default).

- An adopted YouTube iframe is reloaded **once** when its URL lacks `enablejsapi=1` or `origin`, otherwise commands would never reach it.
- Iframes created by a region are marked `data-lp` and never adopted again.

---

## Link data attributes

| Attribute | Meaning |
|---|---|
| `data-link` | Marks the element as a link to bind |
| `data-url` | URL of a **non-`<a>`** element (`<button data-link data-url="…">`). On an `<a>`, `href` is used |
| `data-target` | Target container id (falls back to `defaultTarget`) |
| `data-key` | Custom key (default derived from the URL) |
| `data-title`, `data-description` | Display texts |
| `data-channel`, `data-channel-url` | Channel name / link |
| `data-thumbnail` | Thumbnail URL |
| `data-duration`, `data-start` | Seconds (`90`) or `1h2m3s` style (`1m30s`). `m:ss` is **not** supported |
| `data-autoplay` | `""` or `true` → on init **and** on click, `click` → on click only, `false` / absent → never |
| `data-show-on-init` | Show this item when the page loads |
| `data-index` | Start index in a video list (0-based). The `index` of the URL wins over it |
| `data-videos` | JSON array describing the items of a list / playlist |
| `data-extra` | Free string kept on the info object (not parsed) |

`data-*` booleans follow one rule: attribute present, `""` or `"true"` → true; absent, `"false"`, `"0"`, `"no"` → false.

**Single videos vs lists.** `data-title`, `data-thumbnail`, `data-channel`... describe a **single video**. For a list or playlist, describe the items with `data-videos` (by position for a list; each item needs a `videoId` for a playlist), or let the YouTube Data API / OK.ru `labels=` fill them. The tooltip of a list link shows its first item.

An item of `data-videos` accepts `videoId`, `title`, `description`, `channel`, `channelUrl`, `thumbnail`, `duration`, `start`, `autoplay`, `key`, `extra`.

---

## Definitions

A definition takes the same fields as the attributes, in camelCase: `url`, `target`, `key`, `title`, `description`, `channel`, `channelUrl`, `thumbnail`, `duration`, `start`, `autoplay`, `showOnInit`, `index`, `videos`, `extra`.

Without `url`, give a `provider` and an id; the URL is built for you:

```js
{provider: "youtube", videoId: "dQw4w9WgXcQ", target: "main"}
{provider: "youtube", videoIds: ["id1", "id2"], index: 1, target: "main"}
{provider: "youtube", playlistId: "PLxxxx", videoId: "start", target: "main"}
{provider: "okru",    videoId: "123456789", target: "main"}     // OK.ru: no playlists
```

`target` is required unless `defaultTarget` is set.

---

## Supported URLs

| Provider | Links | Iframes (adopted) |
|---|---|---|
| YouTube | `youtu.be/ID` (`?t=`, `?list=`), `watch?v=` (`&t=`, `&list=`), `watch?list=` (`&v=`, `&index=`), `watch_videos?video_ids=…&index=` | `embed/ID`, `embed/ID?playlist=a,b`, `embed?playlist=a,b`, `embed/videoseries?list=PL`, `embed/ID?list=PL` (also on `youtube-nocookie.com`) |
| OK.ru | `/video/ID`, `/videoembed/ID`, `?video_ids=…&labels=…&index=` | `/videoembed/ID` |

- YouTube ids are validated (11 characters of `A-Z a-z 0-9 _ -`); invalid ids of a `watch_videos` list are dropped.
- `m.youtube.com` and `music.youtube.com` are accepted.
- OK.ru `labels` are split **before** decoding: `%2C` is a comma inside a title, a raw comma separates two titles. An empty label keeps its position.

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
| `scope` | Element id or CSS selector (`"#scope"`) of the root to scan; the document by default. A string only |
| `definitions` | Array of code definitions |
| `autoScan` | Scan at construction (default `true`; call `scan()` yourself otherwise) |
| `defaultTarget` | Target for links and definitions without one |
| `currentBehavior` | Navigating to the info already shown: `"toggle"` (default, shows / hides the container), `"skip"` (nothing), anything else navigates again |
| `boundaryBehavior` | `nextInfo()` / `previousInfo()` at the ends of the list: `"stop"` (default) or `"loop"` (needs 2 infos or more) |
| `activeClass` | Class (or array / space-separated list) put on the links of the info being shown. Default `"is-active"`; `null` or `""` disables |
| `useStorage`, `store` | Persist `{key, index}` per region under `state:<target>`. `store` replaces the default storage (`get(key)`, `set(key, value, ttlMs)`) |
| `scanEmbeds` | Also adopt existing iframes (default `true`) |
| `tooltip` | Hover tooltips (default `true`; never on touch devices) |
| `youtubeApiKey`, `youtubeMeta` | Resolve titles, channels, thumbnails via the YouTube Data API, or give your own resolver |
| `youtubeMetaScope` | `"playlists"` (default: lists and playlists only) or `"all"` (single videos too) |
| `youtubeMetaRequired` | Fields that must not stay empty to trigger the API (default `["title"]`) |
| `fallbackTitle` | `(index) => string`, title of an item still without one (default `Video N`) |
| `okruEmbedBaseUrl` | Base URL of an OK.ru embed relay |
| `registry`, `regionHost` | Replace the provider registry / the discovery service |
| `panelRenderer`, `itemRenderer`, `headerRenderer`, `toggleRenderer`, `groupRenderer`, `tooltipRenderer`, `thumbnails` | UI injection points |
| `onChange`, `onState`, `onError` | Callbacks (same as `lp.on(...)`). `onError` logs a warning by default |

---

## LinkPlayer API

| Member | Purpose |
|---|---|
| `scan()` | Discover what is new in the page (see below) |
| `getRegion(target)` | The region of a target; **created when it does not exist yet** |
| `getSavedState(region)` | The saved `{key, index}` or `null` |
| `on(type, handler)` / `off(type, handler)` | Events of every region (`change`, `state`, `error`, or `"*"`). `on` returns an unsubscribe function |
| `dispose()` | Remove listeners, regions, players and tooltips |
| `id`, `isGlobal`, `useStorage`, `regions` | Read-only state |

### Facade: actions by target

Every common region action, with the target id first:

```js
lp.navigate("main", key, {autoplay: true, index: 2, params: {from: "menu"}});
lp.replace("main", key);
lp.goBack("main");        lp.goForward("main");
lp.nextInfo("main");      lp.previousInfo("main");
lp.nextItem("main");      lp.previousItem("main");     lp.playAt("main", 3);
lp.toggle("main");        lp.show("main");             lp.hide("main");

lp.canGoBack("main");     lp.canGoForward("main");
lp.canGoPreviousInfo("main");   lp.canGoNextInfo("main");
lp.canGoPreviousItem("main");   lp.canGoNextItem("main");
```

- The facade never throws because of an unknown **target**: the region is created, and actions wait for its container (see [Navigation before discovery](#navigation-before-discovery)).
- `navigate` and `replace` still throw for an unknown **key**: a typo stays visible.
- `navigate`, `replace`, `nextInfo` and `previousInfo` count as an **explicit navigation**: at `scan()`, the saved state and `show-on-init` no longer override them.

---

## Region API

```js
const region = lp.getRegion("main");
```

| Group | Members |
|---|---|
| Navigate | `navigate(key, {autoplay, index, params})`, `replace(key, {autoplay, index, params})`, `restore(key, {index, params})` → `false` for an unknown key |
| History | `goBack()`, `goForward()` → `true` when something was restored (`false` while deferred) |
| Between infos | `previousInfo(options)`, `nextInfo(options)` (autoplay is on by default) |
| Inside a list / playlist | `previousItem()`, `nextItem()`, `playAt(index)` |
| Visibility | `toggle()`, `show()`, `hide()` (`hide` hides the container and pauses the player; it does not stop navigation) |
| Hooks | `afterNavigate(hook, {immediate})` → unsubscribe function |
| Metadata | `refreshMeta(key?, {force})` → `Promise<boolean>` |
| Wiring | `adopt(iframe, info, {index, params})`, `register(container)`, `hasPending()`, `addLink(key, element)` → remover |
| Read | `target`, `current`, `currentIndex`, `currentParams`, `isVisible`, `hasContainer`, `itemCount`, `infos`, `isCurrent(key)`, `canGoBack`, `canGoForward`, `canGoPreviousInfo`, `canGoNextInfo`, `canGoPreviousItem`, `canGoNextItem` |
| Infos | `add(info)` → `false` when the key is known, `has(key)`, `get(key)` |
| Lifecycle | `on` / `off`, `dispose()` |

All indexes are **0-based**.

### Params

`navigate(key, {params})` carries free data of *that* navigation (who asked, why...). It is frozen (a snapshot), kept in the history (`back` / `forward` give it again), exposed as `region.currentParams`, in the `change` event and in the hooks. `{}` when none.

### Events

| Event | Detail |
|---|---|
| `change` | `{region, reason, info, index, params, visible}`. `reason`: `navigate`, `replace`, `back`, `forward`, `restore`, `adopt`, `item`, `visibility` |
| `state` | `{region, state, index}`, `state`: `playing`, `paused`, `ended` |
| `error` | `{region, error, info?}`; on `lp`, scan errors come as `{error, element}` |

#### Listening to events

Through callbacks at construction, or with `on()` at any time. `lp.on()` receives the events of **every** region (`event.region` tells which one); `region.on()` only those of one region. `on()` returns a function that removes the handler.

```js
const lp = new LinkPlayer({
  // same as lp.on("change" | "state" | "error", ...)
  onChange: (e) => console.log("change", e.region.target, e.reason),
  onState:  (e) => console.log("state", e.state),
  onError:  (e) => console.warn("error", e.error)
});
```

**`change`**: keep a "now playing" label and the page title in sync.

```js
const label = document.querySelector("#now-playing");

const off = lp.on("change", ({region, reason, info, index, params, visible}) => {
  if (reason === "visibility") return;            // show() / hide() / toggle(): nothing was navigated

  const item = info.isPlaylist ? info.videos[index] : info;
  label.textContent = item?.title ?? info.key;
  document.title = `${item?.title ?? "Player"} · ${region.target}`;

  if (params.from === "menu") console.log("opened from the menu");
});

off();                                            // stop listening
```

**`state`**: react to the player (`"playing"`, `"paused"`, `"ended"`). Go to the next info once the last item of a list, or a single video, has ended.

```js
lp.on("state", ({region, state, index}) => {
  if (state === "ended" && !region.canGoNextItem) {
    lp.nextInfo(region.target);                   // autoplay is on by default
  }
});
```

**`error`**: load, player and metadata failures. Without a handler (or `onError`), errors are logged with `console.warn` / `console.error`.

```js
lp.on("error", ({region, error, info, element}) => {
  // `element` is set for scan errors (a link or iframe that could not be bound)
  console.error(region?.target ?? "scan", info?.key ?? element, error);
});
```

**One region only**, or **everything** with `"*"`:

```js
const main = lp.getRegion("main");
main.on("change", (e) => console.log("main is now", e.info.key));

lp.on("*", (e) => console.debug(e.type, e));      // change, state and error
```

A handler that throws is logged and does not stop the other handlers.

### After-navigation hooks

A hook runs after every navigation (`navigate`, `replace`, `back`, `forward`, `restore`, `adopt`) and every item change: the video is shown, history and panel are up to date. Use it to update the page next to the video. It cannot cancel or alter the navigation, and is not run for `show` / `hide`.

```js
region.afterNavigate(({item, index, params, reason}, from) => {
  title.textContent = item?.title ?? "";
}, {immediate: true});
```

- `to` is `{info, index, item, params, reason}`; `item` is the playing video (`info` for a single video, `info.videos[index]` for a list, `null` while unknown).
- `reason: "meta"`: titles / thumbnails have just been completed. `reason: "immediate"`: the call made by `{immediate: true}` (`from` is `null`).
- A hook that throws or rejects is logged and does not stop the others. The same function registered twice runs once.

---

## Navigation before discovery

A region can exist before its container does (a definition, a facade call, a link whose target is added to the DOM later). Until the container is discovered:

- **Queued**: `navigate`, `replace`, `restore`, `goBack`, `goForward`, `nextInfo`, `previousInfo`, `nextItem`, `previousItem`, `playAt`, `toggle`, `show`, `hide`.
- They run **in the order they were called**, when `register(container)` is called (automatically by `scan()` once the element exists).
- What a step needs (the target of `nextInfo`, the history for `goBack`...) is computed **when it runs**, so a queue of three `nextInfo()` moves three infos.
- Methods that return a boolean return `false` while deferred.
- `navigate` and `replace` still throw at once for an unknown key.
- `region.hasPending()` tells whether something is waiting. `dispose()` drops the queue.

---

## Initialisation and persistence

At the first `scan()` of a region (once per region; a second scan never toggles it):

1. A **saved state** is restored with `restore()` (it never toggles, and only changes the item when the info is already shown).
2. Otherwise the first info with `show-on-init` is navigated to (autoplay only when its `autoplay` is on init).
3. A region already driven by an explicit navigation (facade) skips both.

The state `{key, index}` is saved at every change when `useStorage` is on. The default storage is `localStorage` when reachable, memory otherwise (sandboxed iframes throw on access). With `useStorage: false` everything stays in memory.

---

## Active link class

The links of the info being shown get `activeClass` (default `is-active`), per region:

```js
new LinkPlayer({activeClass: "is-playing"});
```
```css
a[data-link].is-playing { border-color: #f7931e; }
```

All links sharing a key are marked together. Infos without a registered link (a definition, an adopted iframe) mark nothing.

---

## Discovery without observer

`DefaultRegionHost` only **discovers and notifies**: links, target containers and frames. It never manages regions. It does not watch the DOM: after injecting new markup, call:

```js
lp.scan();
```

New containers resolve queued actions; new links are bound; new iframes are adopted. `scan()` is idempotent: what is already known is not handled twice. An element that cannot be handled does not stop the others; the error is reported through the `error` event (`{error, element}`).

### Several instances

Create **scoped** `LinkPlayer`s (with `scope`) **before** the global one. Elements already claimed (`data-lp`) are skipped by the next instance.

---

## YouTube Data API and titles

With `youtubeApiKey`, missing titles, channels, durations and thumbnails are fetched.

- **Priority**: what you declared (`data-*`, `data-videos`, definitions) > API (cached) > fallback title (`Video 1`...). Declared values are never overwritten.
- **When**: only when a *required* field (`youtubeMetaRequired`, the title by default) is empty. Then every other empty field is filled too. Playlists and video lists by default; `youtubeMetaScope: "all"` includes single videos. `refreshMeta()` asks again on demand.
- **Cache**: in the store, 7 days for a video, 1 day for a playlist. An unavailable (private, deleted) video is simply absent from the API answer and keeps its fallback title.
- **Failure**: a refused key or an exhausted quota disables the API for the session; a failed call logs a warning and the defaults are used. Requests time out after 3 s.
- **Without a key**: thumbnails follow the standard `https://i.ytimg.com/vi/<id>/mqdefault.jpg` pattern, titles fall back to your data, then `fallbackTitle`.

> The key is visible in the page. Restrict it by HTTP referrer and to the *YouTube Data API v3* in the Google Cloud console.

---

## OK.ru

- Single videos and **video lists** (`?video_ids=a,b,c&labels=…&index=`). A list is emulated by the player: it changes the `src` for each item and moves on when a video ends.
- No playlists.
- Direct mode: `https://ok.ru/videoembed/ID?autoplay=1&fromTime=90`. With `okruEmbedBaseUrl` (relay): `<relay>?videoId=ID&autoplay=1&startSeconds=90&parentOrigin=…`.
- A per-item `start` is applied.

---

## UI and theming

The panel appears for lists and playlists. It can be closed and reopened with a toggle button, resized (drag the left edge, arrow keys, double-click to reset), and items are keyboard-selectable (`Enter` / `Space`).

### Panel options

Pass your own `PanelRenderer` for options the facade does not expose:

```js
import {PanelRenderer} from "./src/ui/PanelRenderer.js";

new LinkPlayer({
  panelRenderer: new PanelRenderer({open: false, header: false, togglePosition: "bottom-left", seasons: false})
});
```

| Option | Meaning |
|---|---|
| `open` | Panel open at start (default `true`) |
| `header` | Show the header (default `true`) |
| `togglePosition` | `"top-right"` (default), `"bottom-left"` or a style object |
| `seasons` | `true` (default): group items by `Season N` / `S02E05` read from titles; `false`: no grouping; array (`[10, 12]`): explicit number of items per season |
| `handleWidth` | Width of the resize handle |

A custom renderer can set `data-lp-action="close"` or `"toggle-group"` on any element, and `data-index` on an item to make it selectable.

### CSS variables

`--lp-bg`, `--lp-border`, `--lp-hover`, `--lp-text`, `--lp-text-active`, `--lp-muted`, `--lp-accent`, `--lp-w` (panel width), `--lp-z`, `--lp-font`, `--lp-toggle-bg`, `--lp-toggle-color`. Put `data-lp-theme="light"` on an ancestor for the light palette.

### Tooltip

The tooltip shows the thumbnail and title of the link (first item for a list). A missing or failing thumbnail (including YouTube's grey 120 px placeholder) falls back to a provider-coloured card. A `tooltipRenderer` provides `render()`, `onShow(tip, {title, provider})`, `onLoading`, `onThumbLoaded(tip, url)` and `onFallback`.

---

## Writing a provider

Register it through `registry`:

```js
import {ProviderRegistry} from "./src/providers/ProviderRegistry.js";

new LinkPlayer({registry: new ProviderRegistry([new MyProvider()])});
```

A provider has an `id`, a `hosts` array, and:

| Method | Returns |
|---|---|
| `getInfoFromLink(element)` | `VideoInfo` / `VideoListInfo` / `PlaylistInfo` |
| `getInfoFromFrame(iframe)` | the same, for an adopted iframe |
| `getInfoFromDefinition(def)` | the same, from a code definition |
| `createPlayer({iframe})` | a player (below) |

A **player** exposes `iframe`, `load(info, {autoplay, index})`, `subscribe(listener)` (returns an unsubscribe function), `play()`, `pause()`, `next()`, `previous()`, `playAt(index)`, `dispose()`, and optionally `selectItem(info, index, {autoplay})`. It notifies:

```
{type: "itemChange", index}                 the playing item of a list changed
{type: "state", state, index?}              "playing" | "paused" | "ended"
{type: "error", error}
```

---

## Project layout

```
src/
  LinkPlayer.js            facade
  DefaultRegionHost.js     discovery of links, containers and frames
  Region.js                single active item, journal, panel, player, hooks
  NavigationJournal.js     history of {info, index, params}
  metaMerge.js             applies resolved metadata to infos
  storage.js               JsonStore / MemoryStore
  umd.js                   entry of the UMD build
  models/                  VideoInfo, VideoListInfo, PlaylistInfo, UrlInfo, SrcInfo
  providers/               ProviderRegistry, MediaProvider, InfoParser (base)
    youtube/               Provider, InfoParser, EmbedSrcBuilder, IframeBridge, Player, DataApi, MetaResolver
    okru/                  Provider, InfoParser, EmbedSrcBuilder, IframeBridge, Player
  ui/                      PanelRenderer, Tooltip, ThumbnailService
  utils/                   dom, Emitter, helpers, ValueChecks
demo/index.html            demo page
tests/                     Vitest (jsdom)
```

## Demo and tests

- **Demo**: serve the project (`npx vite`) and open `demo/index.html`.
- **Tests**: `npx vitest run`.

## Known limitations

- **YouTube list indexes can drift.** The YouTube player owns its internal list: a deleted or private video is skipped, and a list started at an index above 0 is re-based on it. The player's indexes can then differ from the panel's. Check that every id of a list is playable.
- **YouTube playlists (`list=`) ignore `index`**: `&index=` in the URL and `data-index` apply to video lists only. Use `navigate(key, {index})` from code.
- **A per-item `start` is not applied on YouTube lists and playlists** (they are loaded with `startSeconds: 0`). It works on a single video and on OK.ru lists.
- **Autoplay is subject to browser policies**: autoplay on click works, autoplay at load may be blocked.
- **OK.ru has no playlists.**
- **`scan()` must be called again** after dynamic DOM changes.