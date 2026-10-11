# 落点 Plotip

An Explore / Inspect tool. Plot + IP: put an address on the map. The Chinese name 落点 expresses the same action. This is a product identity, not a claim of a legally exclusive name.

## Identity

The original SVG mark combines a three-panel folded map with a white location pin. Three flat blues describe the folds; the negative-space pin stays legible at favicon size. The lowercase Manrope wordmark is compact, with a quiet Chinese companion. Source: `web/public/plotip-mark.svg`; favicon uses the same geometry. No external logo assets.

## Visual system

Paper #f8f9fb; surface #ffffff; ink #252938; secondary text #606676; blue #315be8; water #e9edf5. Dark surfaces #1c202b / #272c3a; ink #edf0f8; accent #a4b7ff. No gradients or glass.

Manrope for interface/wordmark, PingFang SC for Chinese, IBM Plex Mono for IP addresses and coordinates. Keep the brand distinctive and the controls quiet. Result title and context carry geography once; only additional ISP information gets a detail row.

Desktop: a 76px header, a full-width map and a 344px floating query panel. Mobile: query, concise result, map, history. Reference: Apple Maps' persistent map workspace; Primer's keyboard focus and readable controls. Do not copy their identity.

The previous green full-height rail felt generic and repeated too much information. The revision gives the map the entire workspace, creates a real map-related mark, and removes duplicate result fields. No decorative feature cards or artificial dashboard metrics.

## Map behavior

- Markers must preserve MapLibre's absolute positioning; relative positioning shifts pins as history grows.
- Camera padding excludes the desktop query panel. `fitBounds` uses `absolutePadding: true` so existing padding does not accumulate, including after mobile resize.
- A regional lookup highlights that region, uses its extent for framing, and places a reference marker inside its main polygon. It does not claim device coordinates.
- Canonical administrative names outrank translated names and aliases. Ties are unresolved rather than overwritten by file order. Washington state and District of Columbia have separate mappings.
- The session-history key is versioned to discard cached coordinates from before the correction.
- Country names are DOM markers, not MapLibre symbol layers. At each rendered view, keep the existing zoom/rank hierarchy, then place higher-priority labels first using their rendered text bounds. Leave an 8px gap from other labels, map edges, the floating panel, controls and pins; omit a whole label rather than showing a clipped fragment. Re-evaluate after language/font changes as well as camera movement. Do not shrink the type or move a geographic anchor to fit a name.

## Reverse lookup

The IP lookup / IP ranges switch changes the existing rail, not the workspace. Clicking a map polygon selects the corresponding country or state; a map-level selector makes the selection granularity explicit. Country/state selects provide keyboard and touch alternatives. Rows show actual interval endpoints; details disclose CIDRs and original locality/network records. IPv4/IPv6 and Previous/Next operate on the current place. Empty/error/loading states remain within the same panel. Mobile selectors share a row to leave space for results and the map.
