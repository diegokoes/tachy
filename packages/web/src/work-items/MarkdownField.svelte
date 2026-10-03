<script lang="ts">
  import { Icon, tip } from "../tui";
  import { ATTACHMENT_RE, imageMarkdown, toPreview } from "./ticketMarkdown";
  import type { PastedImage } from "./composer.svelte";

  let {
    id,
    label,
    value,
    images,
    invalid = false,
    onchange,
    onimage,
    onremoveimage,
  }: {
    id: string;
    label: string;
    value: string;
    images: PastedImage[];
    invalid?: boolean;
    onchange: (v: string) => void;
    /** Keeps the file and returns the key its markdown refers to it by. */
    onimage: (file: File) => string;
    onremoveimage: (key: string) => void;
  } = $props();

  let area = $state<HTMLTextAreaElement>();
  let preview = $state(false);

  const urls = $derived(new Map(images.map((i) => [i.key, i.url])));
  const here = $derived(
    images.filter((i) =>
      [...value.matchAll(ATTACHMENT_RE)].some((m) => m[1] === i.key),
    ),
  );

  function insert(text: string) {
    const el = area;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    const before = value.slice(0, at);
    const pad = before && !before.endsWith("\n") ? "\n" : "";
    const next = `${before}${pad}${text}\n${value.slice(end)}`;
    onchange(next);
    const caret = before.length + pad.length + text.length + 1;
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret));
  }

  function takeImages(files: Iterable<File>) {
    let took = false;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const name =
        file.name && file.name !== "image.png"
          ? file.name
          : `pasted-${Date.now()}.png`;
      insert(
        imageMarkdown(
          name,
          onimage(new File([file], name, { type: file.type })),
        ),
      );
      took = true;
    }
    return took;
  }

  function onpaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length && takeImages(files)) e.preventDefault();
  }

  function ondrop(e: DragEvent) {
    if (takeImages(Array.from(e.dataTransfer?.files ?? []))) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function removeImage(key: string) {
    onchange(
      value
        .replace(
          new RegExp(`!\\[[^\\]]*\\]\\(attachment:${key}\\)\\n?`, "g"),
          "",
        )
        .trimEnd(),
    );
    onremoveimage(key);
  }
</script>

<div class="md-field" class:invalid>
  <!-- Written as markdown: the mark stands bold. Previewing, it turns into the
       eye and steps back, since nothing is being written. -->
  <button
    class="md-toggle"
    class:on={!preview}
    aria-pressed={!preview}
    aria-label={preview ? `Write ${label} as markdown` : `Preview ${label}`}
    use:tip={preview ? "back to markdown" : "preview"}
    onclick={() => (preview = !preview)}
  >
    <Icon name={preview ? "eye" : "markdown"} size="1.15em" morph />
  </button>
  {#if preview}
    <div class="preview md">
      {#if value.trim()}
        {@html toPreview(value, urls)}
      {:else}
        <span class="hint">nothing written yet</span>
      {/if}
    </div>
  {:else}
    <textarea
      {id}
      bind:this={area}
      aria-label={label}
      rows="6"
      {value}
      oninput={(e) => onchange((e.target as HTMLTextAreaElement).value)}
      {onpaste}
      {ondrop}
      ondragover={(e) => e.preventDefault()}></textarea>
  {/if}
  {#if here.length}
    <div class="thumbs">
      {#each here as img (img.key)}
        <figure class="thumb">
          <img src={img.url} alt={img.name} />
          <button
            class="x"
            aria-label={`Remove ${img.name}`}
            use:tip={"Remove image"}
            onclick={() => removeImage(img.key)}
          >
            <Icon name="close" size="0.9em" weight={7} />
          </button>
        </figure>
      {/each}
    </div>
  {/if}
</div>

<style>
  .md-field {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .md-field.invalid {
    border-color: var(--danger);
  }
  .md-field:focus-within {
    border-color: var(--accent);
  }
  .md-field {
    position: relative;
  }
  .md-toggle {
    position: absolute;
    top: var(--pad-1);
    right: var(--pad-1);
    z-index: 1;
    display: inline-flex;
    padding: 0.15rem;
    border: none;
    border-radius: var(--radius);
    background: var(--panel-solid);
    color: var(--muted);
    opacity: 0.55;
    cursor: pointer;
    transition:
      color 0.3s ease,
      opacity 0.3s ease;
  }
  .md-toggle :global(svg) {
    stroke-width: 1.1;
    transition: stroke-width 0.35s ease;
  }
  .md-toggle.on {
    color: var(--accent);
    opacity: 1;
  }
  .md-toggle.on :global(svg) {
    stroke-width: 1.9;
  }
  .md-toggle:hover,
  .md-toggle:focus-visible {
    opacity: 1;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  textarea {
    border: none;
    background: transparent;
    resize: vertical;
    min-height: 7rem;
    padding: var(--pad-2) calc(var(--pad-2) + 1.6rem) var(--pad-2) var(--pad-2);
    font: inherit;
    color: var(--text);
    outline: none;
  }
  .preview {
    min-height: 7rem;
    padding: var(--pad-2) calc(var(--pad-2) + 1.6rem) var(--pad-2) var(--pad-2);
    font-family: var(--font-prose);
  }
  .preview :global(img) {
    max-width: 100%;
    border: 1px solid var(--border);
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-2);
    padding: var(--pad-2);
    border-top: 1px dashed var(--border);
  }
  .thumb {
    position: relative;
    margin: 0;
  }
  .thumb img {
    display: block;
    height: 4rem;
    max-width: 8rem;
    object-fit: cover;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .x {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
    display: inline-flex;
    padding: 0.1rem;
    border: none;
    border-radius: var(--radius);
    background: var(--panel-solid);
    color: var(--muted);
    cursor: pointer;
  }
  .x:hover,
  .x:focus-visible {
    color: var(--danger);
  }
</style>
