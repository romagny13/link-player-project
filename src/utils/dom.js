export function resolveScope(scope) {
    if (scope == null) return null;
    if (typeof scope === "string") {
        let node = document.getElementById(scope);
        if (!node) {
            try {
                node = document.querySelector(scope);
            } catch {
                /* not a selector */
            }
        }
        if (node) return node;
    }
    throw new Error(`Scope not found: ${String(scope)}`);
}

export function injectStyles(id, CSS) {
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = CSS;
    document.head.appendChild(s);
}

export function makeIframe({
                               width,
                               height,
                               src,
                               allow,
                               title,
                               referrerPolicy,
                               allowFullscreen = true,
                               extraAttrs = {}
                           }) {
    const iframe = document.createElement("iframe");

    // without width and height, the iframe defaults to 300x150 px
    // YouTube attributes are often width="560" height="315"
    // height: auto does nothing on an iframe -> falls back to 150 px
    if (width) iframe.width = width;
    if (height) iframe.height = height;

    if (!src) throw new TypeError("makeIframe(): src is required");
    iframe.src = src;
    if (title) iframe.title = title;
    iframe.frameBorder = "0";

    /*
          DefBuilder and playback
            Value                Allows the iframe to…
            autoplay             start playback without user gesture
            encrypted-media      play protected media (DRM, EME)
            picture-in-picture   enter picture-in-picture mode
            fullscreen           enter fullscreen (equivalent to allowfullscreen)
            speaker-selection    choose audio output
            display-capture      capture the screen (getDisplayMedia)
            camera               access the camera
            microphone           access the microphone
          Sensors
            Value                Allows the iframe to…
            accelerometer        read the accelerometer (360° videos on mobile)
            gyroscope            read the gyroscope
            magnetometer         read the compass
            ambient-light-sensor read the light sensor
            geolocation          request position
            xr-spatial-tracking  use virtual or augmented reality
            gamepad              read gamepads
          Sharing and clipboard
            Value                Allows the iframe to…
            clipboard-write      write to the clipboard
            clipboard-read       read from the clipboard
            web-share            use native sharing (navigator.share)
          Peripherals
            Value                Allows the iframe to…
            bluetooth            use Web Bluetooth
            usb                  use WebUSB
            serial               use serial ports
            hid                  use HID devices
            midi                 use Web MIDI
          Payment, identity and storage
            Value                Allows the iframe to…
            payment              use the Payment Request API
            publickey-credentials-get / publickey-credentials-create  use WebAuthn (passkeys)
            identity-credentials-get  use federated identity management
            otp-credentials      read a one-time SMS code
            storage-access       request access to third-party cookies
          Miscellaneous
            Value                Allows the iframe to…
            screen-wake-lock     prevent screen from sleeping
            idle-detection       detect user inactivity
            local-fonts          list installed fonts
            keyboard-map         read keyboard layout
            window-management    manage multiple screens
            compute-pressure     read CPU load
            sync-xhr             make synchronous XHR requests
            execution-while-not-rendered / execution-while-out-of-viewport  continue executing when unrendered or off-screen
            browsing-topics, attribution-reporting  Chrome advertising APIs
          */
    if (allow) iframe.allow = allow;

    /* no-referrer        nothing
              no-referrer-when-downgrade  full URL, except from https to http
              origin               only the origin (https://site.com)
              origin-when-cross-origin    full URL for same-site, origin only for others
              same-origin          full URL for same-site, nothing for others
              strict-origin        origin only, nothing from https to http
              strict-origin-when-cross-origin full URL for same-site, origin only for others, nothing from https to http
              unsafe-url           always the full URL
      */
    if (referrerPolicy) iframe.referrerPolicy = referrerPolicy;
    if (allowFullscreen) iframe.allowFullscreen = true;

    // adding extra attributes
    for (const [k, v] of Object.entries(extraAttrs)) iframe.setAttribute(k, v);

    return iframe;
}
