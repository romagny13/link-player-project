# LinkPlayer

**Playlist panels for YouTube embeds, a clean API to drive any video iframe, and plug-ins for everything else.**

Turn plain links, code definitions or existing iframes into **YouTube** and **OK.ru** players, rendered in the container of your choice. Vanilla JS, ES modules, no framework, no DOM observer, and no YouTube API script to load.

```js
const lp = new LinkPlayer();                          // links with [data-link] become players
lp.getRegion("main").use(myBehavior);                 // add your own behavior in one line
lp.on("state", ({region, state}) => { /* playing, paused, ended */ });
```

---

## Highlights

**What you get out of the box**

- **A playlist panel for YouTube embeds.** Playlists and lists of video ids get a built-in panel (resizable, collapsible, keyboard-friendly, grouped by season if you want), even on an iframe that is already in your page.
- **A clean API to drive the iframe.** Play, pause, seek, next / previous item, mute and volume, plus events (`change`, `state`, `sound`, `error`). It talks to the player through `postMessage`: no `iframe_api` script, no global callback.
- **Smart iframe handling.** A new iframe is created only when the *info* changes. Same info + another item = a single player command (YouTube) or a `src` change (OK.ru), never a new player.
- **Three ways to declare videos**: HTML links, JavaScript definitions, or adopted `<iframe>`s. Without JavaScript, links still open the video page.
- **YouTube Shorts and formats.** Landscape, portrait (9/16, Shorts are detected) or square, exposed on the container for your CSS.
- **Autoplay that works.** Start muted to play on page load, mute / unmute from your own button.
- **Titles, channels and durations** completed through the YouTube Data API (cached), with your declared values always winning.
- **Resume where you left off.** Optional persistence of the last item per region.

**Built to be extended**

- **Behaviors.** Panel, metadata, persistence, active link, format and mute are small plug-ins of a region. Write your own on the public hook API (`afterNavigate`, events, commands): skip-intro buttons, analytics, auto-next...
- **Providers.** Support another platform by writing a provider and a view. YouTube and OK.ru are built the same way.
- **Pluggable UI.** Panel, items, header, toggle, groups and tooltip renderers can all be replaced or extended (vertical cards for Shorts, for example).
- **Regions.** Each container is a `Region`: one active item, a navigation journal (back / forward), hooks and behaviors. A region exists before its container does, and shows its *current* state as soon as the container is found.

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

A **target** is the `id` of its container. The container is looked up by id **inside the scan root** (the `scope`, or the document).

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
lp.getRegion("main").navigate("youtube:ID");
```

An invalid definition (unknown provider, missing target...) throws from the constructor.

### 3. Mixed

Definitions and links coexist. Definitions are registered **before** the first scan and **a key is unique: the first info added wins**. A definition therefore wins over a link with the same key (the link then drives the definition's info).

### Adopting an existing iframe

An iframe already in the page (YouTube `embed` or OK.ru `videoembed`) is parsed, its parent becomes the target container (an id `host:<uuid>` is generated if the parent has none) and the region *adopts* it. Needs `scanEmbeds: true` (default).

- An adopted YouTube iframe is reloaded **once** when its URL lacks `enablejsapi=1` or `origin`, otherwise commands would never reach it.
- An adopted YouTube iframe with `mute=1` in its URL is a muted info (see [Sound](#sound)).
- An embed URL does not tell the format: an adopted iframe is `landscape` unless you say otherwise (see [Format](#format)).
- Iframes created by a region are claimed and never adopted again.

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
| `data-autoplay` | `""`, `true` or `init` → on init **and** on click, `click` → on click only, `false` / absent → never |
| `data-show-on-init` | Show this item when the page loads |
| `data-index` | Start index in a video list (0-based). The `index` of the URL wins over it |
| `data-videos` | JSON array describing the items of a list / playlist |
| `data-format` | `landscape`, `portrait`, `square` (aliases: `9/16`, `short`...). See [Format](#format) |
| `data-mute` | Start muted. See [Sound](#sound) |
| `data-extra` | Free string kept on the info object (not parsed) |

`data-*` booleans follow one rule: attribute present, `""` or `"true"` → true; absent, `"false"`, `"0"`, `"no"` → false.

**Single videos vs lists.** `data-title`, `data-thumbnail`, `data-channel`... describe a **single video**. For a list or playlist, describe the items with `data-videos` (by position for a list; each item needs a `videoId` for a playlist), or let the YouTube Data API / OK.ru `labels=` fill them. The tooltip of a list link shows its first item.

An item of `data-videos` accepts `videoId`, `title`, `description`, `channel`, `channelUrl`, `thumbnail`, `duration`, `start`, `autoplay`, `format`, `key`, `extra`.

---

## Definitions

A definition takes the same fields as the attributes, in camelCase: `url`, `target`, `key`, `title`, `description`, `channel`, `channelUrl`, `thumbnail`, `duration`, `start`, `autoplay`, `showOnInit`, `index`, `videos`, `format`, `mute`, `extra`. `extra` can be any value (an object for example); a link can only give a string.

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
| YouTube | `youtu.be/ID` (`?t=`, `?list=`), `watch?v=` (`&t=`, `&list=`), `watch?list=` (`&v=`, `&index=`), `watch_videos?video_ids=…&index=`, `shorts/ID` (`?t=`) | `embed/ID`, `embed/ID?playlist=a,b`, `embed?playlist=a,b`, `embed/videoseries?list=PL`, `embed/ID?list=PL` (also on `youtube-nocookie.com`) |
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

Two links to the same video without a custom key share the same info (and the same `data-title`...: the first one wins). Give them different keys to describe them differently.

---

## Options

```js
new LinkPlayer({ /* all optional */ })
```

| Option | Purpose |
|---|---|
| `scope` | Element, element id or CSS selector (`"#scope"`) of the root to scan; the document by default. An unknown scope throws |
| `definitions` | Array of code definitions |
| `autoScan` | Scan at construction (default `true`; call `scan()` yourself otherwise) |
| `defaultTarget` | Target for links and definitions without one |
| `currentBehavior` | A **click** on the link of the info already shown: `"toggle"` (default, hides / shows the container), `"skip"` (nothing), `"playPause"` (plays or pauses, the visibility does not change). `region.navigate()` always navigates, whatever this option says |
| `boundaryBehavior` | `nextInfo()` / `previousInfo()` at the ends of the list: `"stop"` (default) or `"loop"` (needs 2 infos or more) |
| `activeClass` | Class (or array / space-separated list) put on the links of the info being shown. Default `"is-active"`; `null` or `""` disables |
| `activeWhenPlaying` | `true`: the active class is only there while the player plays (default `false`: while the info is shown) |
| `useStorage`, `store` | Persist `{key, index}` per region. The default store is `localStorage` when reachable, memory otherwise. `store` replaces it (`get(key)`, `set(key, value, ttlMs)`, `remove(key)`). The YouTube API cache uses the same store, so `useStorage: false` also keeps it in memory |
| `scanEmbeds` | Also adopt existing iframes (default `true`) |
| `tooltip` | Hover tooltips (default `true`; never on touch devices) |
| `youtubeApiKey`, `youtubeMeta` | Resolve titles, channels, thumbnails via the YouTube Data API, or give your own resolver |
| `youtubeMetaScope` | `"playlists"` (default: lists and playlists only) or `"all"` (single videos too) |
| `youtubeMetaRequired` | Fields that must not stay empty to trigger the API (default `["title"]`) |
| `fallbackTitle` | `(index) => string`, title of a list item still without one (default `Video N`) |
| `okruEmbedBaseUrl` | Base URL of an OK.ru embed relay |
| `registry`, `regionHost` | Replace the provider registry / the discovery service |
| `panelOptions` | Options of the panel of every region (see [Panel options](#panel-options)) |
| `itemRenderer`, `headerRenderer`, `toggleRenderer`, `groupRenderer`, `tooltipRenderer`, `thumbnails` | UI injection points |
| `onChange`, `onState`, `onError` | Callbacks (same as `lp.on(...)`). `onError` logs a warning by default |

---

## LinkPlayer API

| Member | Purpose |
|---|---|
| `scan()` | Discover what is new in the page (see below) |
| `getRegion(name)` | The region of a target; **created when it does not exist yet** |
| `navigate(name, key, options)` | Shortcut for `getRegion(name).navigate(key, options)` |
| `nextInfo(name, options)` | Shortcut for `getRegion(name).nextInfo(options)` → `boolean` |
| `previousInfo(name, options)` | Shortcut for `getRegion(name).previousInfo(options)` → `boolean` |
| `refreshMeta(name, key?, {force})` | Ask the metadata of an info again (default: the current info, forced) → `Promise<boolean>` |
| `on(type, handler)` / `off(type, handler)` | Events of every region (`change`, `state`, `sound`, `before`, `error`, or `"*"`). `on` returns an unsubscribe function |
| `dispose()` | Remove listeners, regions, views and tooltips |
| `id`, `isGlobal`, `regions` | Read-only state |

### Facade methods

`navigate`, `nextInfo` and `previousInfo` are the only region commands wrapped by `LinkPlayer`. Each one takes the **target name** (the container id) first, then forwards the rest to the region. They are meant for buttons and code that do not hold the region.

```js
lp.navigate("main", "youtube:ID");                          // go to an info by key
lp.navigate("main", "youtube:list:a,b,c", {index: 2});      // start a list at its 3rd item
lp.navigate("main", "youtube:ID", {autoplay: true, params: {from: "menu"}});

lp.nextInfo("main");                                        // autoplay is on by default
lp.previousInfo("main", {autoplay: false});
```

- `options` are the ones of the region: `navigate` takes `{autoplay, index, params}`, `nextInfo` / `previousInfo` take `{autoplay, params}`.
- `navigate` always navigates, even toward the info already shown. What a *click* on the current info does (`currentBehavior`) belongs to links, not to this call.
- `nextInfo` / `previousInfo` return `false` when there is no info in that direction (see `boundaryBehavior`).
- An unknown **key** throws (a typo stays visible). An unknown **target** is fine: the region is created and waits for its container.

### Everything else goes through the region

History, items inside a list, player, sound and visibility have no shortcut. Get the region and use it:

```js
const region = lp.getRegion("main");

region.back();
region.nextItem();
region.selectItem(3);
region.play();
region.toggleMute();
region.toggle();
```

See [Region API](#region-api) for the full list.

## Region API

```js
const region = lp.getRegion("main");
```

| Group | Members |
|---|---|
| Navigate | `navigate(key, {autoplay, index, params})`, `replace(key, {autoplay, index, params})`, `restore(key, {index, params})` → `false` for an unknown key, `activate(key, options)` (what a click does: applies `currentBehavior`) |
| History | `back()`, `forward()` → `true` when something was restored |
| Between infos | `previousInfo(options)`, `nextInfo(options)` (autoplay is on by default) |
| Inside a list / playlist | `previousItem()`, `nextItem()`, `selectItem(index, {autoplay})` |
| Player | `play()`, `pause()`, `seekTo(seconds, {play})` |
| Sound | `mute()`, `unmute()`, `toggleMute()`, `setVolume(0..1)`, `muted`, `volume`, `canMute` |
| Visibility | `toggle()`, `show()`, `hide()` (`hide` hides the container and pauses the player; it does not stop navigation) |
| Hooks | `afterNavigate(hook, {immediate})` → unsubscribe function, `use(behavior)`, `notify(reason)`, `report(error, context)`, `context(reason)` |
| Wiring | `add(info)` (returns the info the region holds for this key), `attach(element)`, `detach()`, `adopt(iframe, info, {index, params})` |
| Read | `name`, `element`, `view`, `current`, `currentIndex`, `currentParams`, `itemCount`, `infos`, `playerState`, `isVisible`, `canGoBack`, `canGoForward`, `canGoPreviousInfo`, `canGoNextInfo`, `canGoPreviousItem`, `canGoNextItem`, `has(key)`, `get(key)`, `isCurrent(key)` |
| Lifecycle | `on` / `off`, `dispose()` |

All indexes are **0-based**. `itemCount` is `0` for a single video and `null` when a list's length is unknown.

### Params

`navigate(key, {params})` carries free data of *that* navigation (who asked, why...). It is frozen (a snapshot), kept in the history (`back` / `forward` give it again), exposed as `region.currentParams`, in the `change` event and in the hooks. `{}` when none.

### Events

| Event | Detail |
|---|---|
| `change` | The navigation context: `{region, info, index, item, params, reason, view}`. `reason`: `navigate`, `replace`, `back`, `forward`, `restore`, `adopt`, `attach`, `detach`, `item`. Not emitted for `meta` and `immediate` (hooks only) nor for `show` / `hide` |
| `state` | `{region, state, index}`, `state`: `playing`, `paused`, `ended`. `play()` / `pause()` assume their state at once |
| `sound` | `{region, muted, volume}` (`volume` is 0..1, `null` when unknown). See [Sound](#sound) |
| `before` | `{region, view, info}`: a **new view** was created and loaded, and is about to be inserted in the container. See [Before the view is placed](#before-the-view-is-placed) |
| `error` | `{region, error, info?}` (`{region, error, hook}` for a failing hook); on `lp`, scan errors come as `{error, element}` |

#### Listening to events

Through callbacks at construction, or with `on()` at any time. `lp.on()` receives the events of **every** region (`event.region` tells which one); `region.on()` only those of one region. `on()` returns a function that removes the handler.

```js
const lp = new LinkPlayer({
  // same as lp.on("change" | "state" | "error", ...)
  onChange: (e) => console.log("change", e.region.name, e.reason),
  onState:  (e) => console.log("state", e.state),
  onError:  (e) => console.warn("error", e.error)
});
```

**`change`**: keep a "now playing" label and the page title in sync.

```js
const label = document.querySelector("#now-playing");

const off = lp.on("change", ({region, reason, info, item, params}) => {
  label.textContent = item?.title ?? info.key;
  document.title = `${item?.title ?? "Player"} · ${region.name}`;

  if (params.from === "menu") console.log("opened from the menu");
});

off();                                            // stop listening
```

**`state`**: react to the player. Go to the next info once the last item of a list, or a single video, has ended.

```js
lp.on("state", ({region, state}) => {
  if (state === "ended" && !region.canGoNextItem) {
    region.nextInfo();                            // autoplay is on by default
  }
});
```

**`error`**: load, player and metadata failures. Without a handler, errors are logged with `console.warn`.

```js
lp.on("error", ({region, error, info, element}) => {
  // `element` is set for scan errors (a link or iframe that could not be bound)
  console.error(region?.name ?? "scan", info?.key ?? element, error);
});
```

**One region only**, or **everything** with `"*"`:

```js
const main = lp.getRegion("main");
main.on("change", (e) => console.log("main is now", e.info.key));

lp.on("*", (e) => console.debug(e.type, e));
```

A handler that throws is logged and does not stop the other handlers.

### After-navigation hooks

A hook runs after every navigation (`navigate`, `replace`, `back`, `forward`, `restore`, `adopt`) and every item change: the view is shown, history and panel are up to date. Use it to update the page next to the video. It cannot cancel or alter the navigation, and is not run for `show` / `hide`.

```js
region.afterNavigate(({item, index, params, reason, view}, from) => {
  title.textContent = item?.title ?? "";
}, {immediate: true});
```

- The first argument is the same context as the `change` event: `{region, info, index, item, params, reason, view}` (frozen). `item` is the playing video (`info` for a single video, `info.videos[index]` for a list, `null` while unknown). `view` is the active view, `null` when there is none for this info. `from` is the previous context, or `null`.
- Hooks also run for the reasons `attach` / `detach` (the container came / left), `meta` (titles / thumbnails have just been completed) and `immediate` (the call made by `{immediate: true}`, or a `scan()` that notifies regions that are already initialised). The `change` event is not emitted for the last two.
- A hook that throws is reported through `error` and does not stop the others. The same function registered twice runs once.
- A hook runs in the same task as the navigation: changes it makes to the DOM (a class on the container, for example) are painted together with the new view, without a flash.

---

## Regions and containers

A region can exist before its container does (a definition, a `region.navigate()` call, a link whose target is added to the DOM later):

- Until the container is found, `navigate()` and friends only move the **journal**. Nothing is replayed: when `scan()` finds the container, the region shows its **current** state (the last navigation, not all of them).
- An `autoplay` requested while there was no container is kept for 2 seconds only.
- `show()`, `hide()` and the item / player commands do nothing without a container or a view (the boolean ones return `false`).
- A container that leaves the DOM is released at the next `scan()` (reason `detach`): the view goes, the state stays. Binding a new container shows the current state again.
- A container is bound to **one** region; binding it to a second name throws.

---

## Initialisation and persistence

At the first `scan()` of a region (once per region; a second scan never toggles it):

1. A **saved state** is restored with `restore()` (it never plays).
2. Otherwise the first info with `show-on-init` is navigated to (autoplay only when its `autoplay` is on init).

The state `{key, index}` is saved at every navigation and item change when `useStorage` is on, under `lp:state:<region name>` with the default store. With `useStorage: false` everything stays in memory. A saved key that no longer exists is ignored.

---

## Active link class

The links of the info being shown get `activeClass` (default `is-active`), per region:

```js
new LinkPlayer({activeClass: "is-playing", activeWhenPlaying: true});
```
```css
a[data-link].is-playing { border-color: #f7931e; }
```

All links sharing a key are marked together. Infos without a registered link (a definition, an adopted iframe) mark nothing.

---

## Format

Every video has a `format`: `"landscape"` (default), `"portrait"` (9/16) or `"square"`.

**Where it comes from**, in order of priority:

1. `data-format` on the link, or `format` in a definition.
2. The URL: a YouTube `/shorts/ID` link is `portrait`.
3. `"landscape"`.

Accepted values and aliases: `portrait` (`vertical`, `short`, `shorts`, `reel`, `9/16`, `9:16`), `landscape` (`horizontal`, `wide`, `16/9`, `16:9`), `square` (`1/1`, `1:1`). An unknown value is ignored.

```html
<a data-link href="https://www.youtube.com/shorts/ID">Short</a>              <!-- portrait, detected -->
<a data-link data-format="9/16" href="https://ok.ru/video/123">Vertical</a>   <!-- forced -->
```

```js
{url: "https://youtu.be/ID", target: "main", format: "portrait"}
```

- On a list or playlist, the format applies to the list and to its items, unless an item of `data-videos` / `videos` sets its own.
- `youtu.be/ID` and embed URLs cannot tell a Short from a video: use `data-format` or `format`.
- Read it in code: `info.format`, `item.format`, or `ctx.item.format` in a hook.

**For your CSS.** `FormatBehavior` puts the format of the current item on the container as `data-lp-format` (it follows the item inside a playlist):

```css
.player-zone iframe { width: 100%; height: auto; aspect-ratio: 16 / 9; border: 0; }

/* the container takes the shape of the player: no bars around it */
.player-zone[data-lp-format="portrait"] { width: min(100%, 360px, 45vh); margin-inline: auto; }
.player-zone[data-lp-format="portrait"] iframe { aspect-ratio: 9 / 16; }
.player-zone[data-lp-format="square"]   { width: min(100%, 480px, 80vh); margin-inline: auto; }
.player-zone[data-lp-format="square"] iframe { aspect-ratio: 1; }
```

`height: auto` is needed: the iframes the plugin creates carry a `height="315"` attribute, which cancels `aspect-ratio`.

---

## Sound

### Start muted

`data-mute` on a link, or `mute: true` in a definition, makes the video start muted. The user can unmute it afterwards.

```html
<a data-link data-autoplay="click" data-mute href="https://www.youtube.com/watch?v=ID">Muted</a>
```

Browsers only allow autoplay **without a user gesture** when the video is muted, so this is the way to play a video when the page loads:

```html
<a data-link data-show-on-init data-autoplay data-mute href="https://www.youtube.com/watch?v=ID">Hero</a>
```

On YouTube, `mute=1` is added to the embed URL (that is what makes the autoplay possible), then the player is muted with a command. An adopted iframe with `mute=1` in its URL is muted too. `MuteBehavior` applies it once per view; there is one view per info.

### Control

```js
region.mute();   region.unmute();   region.toggleMute();
region.setVolume(0.5);                       // 0..1

region.muted;    // true | false | null (unknown)
region.volume;   // 0..1 | null (unknown)
region.canMute;  // false when the view cannot be controlled (OK.ru)

lp.on("sound", ({region, muted, volume}) => button.textContent = muted ? "🔇" : "🔊");
button.onclick = () => lp.getRegion("hero").toggleMute();
```

`muted` and `volume` are reset when the view changes. The `sound` event also fires when the user changes the sound with the player's own controls.

### OK.ru

OK.ru **cannot be muted or have its volume set**: no way is known, neither in the embed URL nor with `postMessage`. `canMute` is `false`, `mute()`, `unmute()` and `setVolume()` do nothing, and an info with `mute` reports `mute is not supported by 'okru'` through the `error` event. Do not combine `data-mute` with an unattended autoplay on OK.ru: the video would play with sound, or be blocked by the browser.

---

## Behaviors

A behavior is `{attach(region), dispose?(region)}`. It lives as long as its region and only uses the public API (hooks, events, commands). `LinkPlayer` plugs these ones in, in this order:

| Behavior | Role |
|---|---|
| `FormatBehavior` | `data-lp-format` on the container |
| `MetaBehavior` | Completes the metadata of an info the first time it is shown (`meta` reason) |
| `MuteBehavior` | Mutes the views of muted infos |
| `PanelBehavior` | Draws the playlist panel and keeps it on the playing item |
| `PersistenceBehavior` | Saves and restores `{key, index}` |
| `ActiveLinkBehavior` | The active class on the links |

The order matters: hooks run in this order. `FormatBehavior` is first so that the iframe has its final size when the panel measures it.

Your own behavior, on a region:

```js
region.use({
  attach(region) {
    this.off = region.afterNavigate(({info, view}) => { /* ... */ });
  },
  dispose() { this.off?.(); }
});
```

### Before the view is placed

`region.on("before", ({region, view, info}) => ...)` fires when a **new view** has been created and loaded and is about to be inserted: `view.root` (the iframe) exists but is not in the DOM yet. Use it to adjust the iframe itself (attributes, `allow`, `loading`).

It is **not** emitted when the item changes inside the same view, for `show` / `hide`, or when an iframe is adopted. For anything that depends on the current item (a class on the container, a label), use `afterNavigate`.

---

## Discovery without observer

`RegionHost` only **discovers**: links (`[data-link]`), target containers (by `id`) and frames. It never manages regions. It does not watch the DOM: after injecting new markup, call:

```js
lp.scan();
```

A new container is attached to its region (which shows its current state); new links are bound; new iframes are adopted. `scan()` is idempotent: what is already known is not handled twice. An element that cannot be handled does not stop the others; the error is reported through the `error` event (`{error, element}`).

Handled elements carry `data-lp` (the name of their owner). This attribute is only a mirror for the dev tools: ownership lives in a `WeakMap`, so a cloned element is a new element.

### Several instances

Create **scoped** `LinkPlayer`s (with `scope`) **before** the global one. Elements already claimed (`data-lp`) are skipped by the next instance.

---

## YouTube Data API and titles

With `youtubeApiKey`, missing titles, channels, durations and thumbnails are fetched.

- **Priority**: what you declared (`data-*`, `data-videos`, definitions) > API (cached) > fallback title (`Video 1`...). Declared values are never overwritten.
- **When**: only when a *required* field (`youtubeMetaRequired`, the title by default) is empty. Then every other empty field is filled too. Playlists and video lists by default; `youtubeMetaScope: "all"` includes single videos. `lp.refreshMeta()` asks again on demand. When the metadata arrives, hooks run again with `reason: "meta"`.
- **Cache**: in the store, 7 days for a video, 1 day for a playlist. An unavailable (private, deleted) video is simply absent from the API answer and keeps its fallback title.
- **Failure**: a refused key or an exhausted quota disables the API for the session; a failed call logs a warning and the defaults are used. Requests time out after 3 s.
- **Without a key**: thumbnails follow the standard `https://i.ytimg.com/vi/<id>/mqdefault.jpg` pattern, titles fall back to your data, then `fallbackTitle`. A single video has no fallback title.

Your own resolver (`youtubeMeta`) needs `resolve(info, {force})` returning `[{id, title, description, channel, channelUrl, thumbnail, duration}]` (one item for a single video), or `null` when there is nothing to do.

> The key is visible in the page. Restrict it by HTTP referrer and to the *YouTube Data API v3* in the Google Cloud console.

---

## OK.ru

- Single videos and **video lists** (`?video_ids=a,b,c&labels=…&index=`). A list is emulated by the view: it changes the `src` for each item and moves on when a video ends.
- No playlists. No sound control (see [Sound](#sound)).
- Direct mode: `https://ok.ru/videoembed/ID?autoplay=1&fromTime=90`. With `okruEmbedBaseUrl` (relay): `<relay>?videoId=ID&autoplay=1&startSeconds=90&parentOrigin=…`.
- A per-item `start` is applied.
- A relay is a small page that embeds the OK.ru iframe, forwards the player messages (`started`, `paused`, `ended`, `timeupdate`...) to your page and the commands (`play`, `pause`) to the player. It lets the view get the player state in a context where the direct embed does not report it.

---

## UI and theming

The panel appears for lists and playlists. It can be closed and reopened with a toggle button, resized (drag the left edge, arrow keys, double-click to reset), and items are keyboard-selectable (`Enter` / `Space`). Every region has its own panel.

### Panel options

```js
new LinkPlayer({
  panelOptions: {open: false, header: false, togglePosition: "bottom-left", seasons: false}
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

Register it through `registry` (this replaces the default one: add `YouTubeProvider` / `OkruProvider` yourself if you still need them):

```js
import {ProviderRegistry} from "./src/providers/ProviderRegistry.js";

new LinkPlayer({registry: new ProviderRegistry([new MyProvider()])});
```

A provider extends `MediaProvider`: an `id`, a `hosts` array, an optional `name` (used by the tooltip), and:

| Method | Returns |
|---|---|
| `getInfoFromLink(element)` | `VideoInfo` / `VideoListInfo` / `PlaylistInfo` |
| `getInfoFromFrame(iframe)` | the same, for an adopted iframe |
| `getInfoFromDefinition(def)` | the same, from a code definition |
| `createView({iframe})` | a view (below); an `iframe` means "adopt it" |

An info carries `format` and `mute` like the others; a new provider can set its own default format (a TikTok provider would use `portrait`).

A **view** extends `MediaView`. It exposes `root` (the iframe), `owned`, `kind`, `togglePosition`, `canMute`, `load(info, {autoplay, index})`, `subscribe(listener)` (returns an unsubscribe function), `play()`, `pause()`, `next()`, `previous()`, `playAt(index)`, `seekTo(seconds, {play})`, `mute()`, `unmute()`, `setVolume(0..1)`, `dispose()`, and optionally `selectItem(info, index, {autoplay})`. The commands it does not support stay no-ops, and `canMute` stays `false`. It notifies:

```
{type: "itemChange", index}                 the playing item of a list changed
{type: "state", state, index?}              "playing" | "paused" | "ended"
{type: "sound", muted, volume}              volume 0..1
{type: "error", error}
```

---

## Project layout

```
src/
  LinkPlayer.js            composition root: builds the parts, wires them, scans the page
  Region.js                single active item, journal, view, hooks, behaviors
  RegionHost.js            discovery of links, containers and frames
  RegionCatalog.js         name -> region, and the element of each region
  NavigationJournal.js     history of {info, index, params}
  MetaService.js           completes the metadata of an info
  metaMerge.js             applies resolved metadata to infos
  storage.js               JsonStore / MemoryStore
  umd.js                   entry of the UMD build
  adapters/                ContentAdapter, SingleActiveAdapter (how views sit in the container)
  behaviors/               Format, Meta, Mute, Panel, Persistence, ActiveLink
  models/                  VideoInfo, VideoListInfo, PlaylistInfo, UrlInfo (+ SrcInfo)
  providers/               ProviderRegistry, MediaProvider, InfoParser (base)
    youtube/               Provider, InfoParser, EmbedSrcBuilder, ThumbnailUrlBuilder, IframeBridge, View, DataApi, MetaResolver
    okru/                  Provider, InfoParser, EmbedSrcBuilder, IframeBridge, View
  views/                   MediaView, ViewFactory, IframeFactory, CommandBinder
  ui/                      PanelRenderer, Tooltip, ThumbnailService
  utils/                   dom, Emitter, helpers, items, ownership, ValueChecks
demo/index.html            demo page
tests/                     Vitest (jsdom)
```

## Demo and tests

- **Demo**: serve the project (`npx vite`) and open `demo/index.html`. It has one section per mode (links, definitions, adoption, YouTube Data API, dynamic scan, code only, global vs scoped, navigation buttons and behaviors, format and mute) and an event log.
- **Tests**: `npx vitest run`.

## Known limitations

- **OK.ru cannot be muted** and has no volume control (see [Sound](#sound)). It has no playlists either.
- **Format cannot be detected** from `youtu.be/ID` links or from embed URLs: declare it with `data-format` / `format`.
- **YouTube list indexes can drift.** The YouTube player owns its internal list: a deleted or private video is skipped, and a list started at an index above 0 is re-based on it. The player's indexes can then differ from the panel's. Check that every id of a list is playable.
- **YouTube playlists (`list=`) ignore `index`**: `&index=` in the URL and `data-index` apply to video lists only. Use `region.navigate(key, {index})` from code.
- **A per-item `start` is not applied on YouTube lists and playlists** (they are loaded with `startSeconds: 0`). It works on a single video and on OK.ru lists.
- **Autoplay is subject to browser policies**: autoplay on click works; autoplay at load only works muted (`data-mute`) and may still be blocked.
- **`scan()` must be called again** after dynamic DOM changes.