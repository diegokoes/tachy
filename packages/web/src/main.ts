// The two defaults load eagerly so first paint never flashes. Every other
// pickable face is code-split behind a dynamic import in lib/fonts.ts.
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/ibm-plex-sans/wght-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
// Not a pickable face: the tail of every stack, carrying the block and
// box-drawing glyphs the TUI chrome draws with. See tokens.css.
import "@fontsource/dejavu-mono/latin-400.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });

export default app;
