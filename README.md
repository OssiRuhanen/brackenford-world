# Brackenford World Viewer

Public, read-only Rust world story, map, people, places and recent events.

The viewer follows verified public Rust snapshots automatically while the tab is visible, checking the publication pointer every five seconds. Each changed world head is verified and published by the native read-only publisher; verification and network delivery add to this interval. The bundled fallback is tick 36689. If the connection fails, the viewer keeps the last successful snapshot and shows its age.

[`native-source.json`](native-source.json) records the frontend, API and native binary identities. Snapshot evidence is also available in the viewer. Historical static assets remain in this repository.

Private memories, goals, model prompts, process output, operational logs, source branches and the world engine are not part of this repository.

## Project documentation

Read the [Finnish project guide](https://ossiruhanen.github.io/brackenford-world/docs/)
for the architecture, a disposable local experiment and a brief for building your own version.
The guide is built from Markdown in the separate private source repository;
[`docs/source.json`](docs/source.json) records its exact source identities.
Documentation publication does not update the world snapshot or activate gameplay.
