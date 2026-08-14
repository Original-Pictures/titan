# Original Pictures brand guidelines for Titan

This is the canonical design policy for work created in Titan. It applies to every user-facing
app, Gadget, document, report, presentation, export, and other artifact unless the user explicitly
asks for a different visual identity. It does not require cosmetic changes to code-only or
infrastructure work.

Titan is the product. Original Pictures is the organization behind it. Use **Titan** as the product
name and **Original Pictures** as the organization name. The preferred tagline is *The record behind
content.* For provenance-specific work, use *Proof of origin for everything, captured or created.*

## Design direction

Use an editorial, precise, provenance-focused design: restrained navy surfaces, ivory light
surfaces, and a sparse brass accent. Favor clear hierarchy, generous whitespace, thin borders, and
tight 6px corners. Do not use gradient text, oversized rounded/pill cards, neon or highly saturated
colors, or emoji in headings and body copy.

Use Lora, or a comparable editorial serif, for headings and significant statistics; use Inter, or a
comparable clean sans-serif, for body and UI text; use a monospace face for code, technical metadata,
and legal disclaimers. Treat code examples as first-class content with a label and a clear result.

Use CSS variables rather than inline color values:

```css
:root {
  --surface: #0D1B2A;
  --surface-2: #1A2E42;
  --surface-3: #243852;
  --border: #2E4A62;
  --text: #F5F0E8;
  --text-muted: #8AA4B8;
  --primary: #B8922A;
  --accent: #D4A84B;
  --success: #3A7D44;
  --danger: #C0392B;
  --radius: 6px;
  --font-head: 'Lora', serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'Courier New', monospace;
}
```

For externally shared reports and documents, use the light variant: Warm White `#FDFAF5` as the
surface, Ivory `#F5F0E8` for secondary surfaces, Navy `#0D1B2A` for text, Slate `#4A6070` for muted
text, and Brass `#B8922A` only for emphasis. Brass should occupy no more than about 10% of a layout:
reserve it for the primary action, key metric, eyebrow label, or icon—not all of them at once.

## Artifact structure

Start shared artifacts with a compact hero: a brass, uppercase eyebrow; a flat serif H1; one concrete
proof sentence; and restrained generated-date/context metadata. Use a 1100px maximum width for
dashboards and 800px for reports or documentation. Use responsive grids, simple cards, and 1px
borders. Do not use gradients in headings.

Externally shared artifacts should end with a small footer that identifies Original Pictures and includes
the stamp `tamper-evident · verify anywhere`. Add this disclaimer when the content discusses provenance,
compliance, verification, or legal implications: “Verifies provenance signals and integrity
relationships. Does not prove that a depicted event is true, and is not by itself legal compliance
with any regime. Nothing here is legal advice.” Set the disclaimer in small monospace text.

When technically and contextually relevant, C2PA, CAI, NVIDIA Inception, OpenTimestamps, CAWG Identity,
RFC 3161, TrustMark, AudioSeal, and VideoSeal may be named. Never imply that a product uses, is certified
by, or is partnered with any standard or organization without evidence.

## Voice and content

Lead with the problem or consequence, then the proof or action. Write short, direct, declarative
sentences. Use exact figures when they are known and sourced; otherwise qualify the statement or omit
the figure. Avoid filler and hype, including “seamlessly,” “leverage,” “empower,” and “unlock.”

Prefer action-first CTAs: `Book a demo →`, `See how it works`, and `Try it yourself`. Do not make
unverified factual, legal, security, or provenance claims. Preserve accessibility: sufficient contrast,
semantic headings, legible type sizes, visible keyboard focus, and text alternatives for meaningful
images.

## Working rule for agents

When creating or materially changing a user-facing artifact, apply this guidance by default. If a user
provides a conflicting brand or visual direction for that artifact, follow the user's explicit direction
instead. Keep this policy in mind for generated content, layouts, CSS, imagery, and copy—not merely for
the final polish pass.
