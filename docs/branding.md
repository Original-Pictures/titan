# Titan branding

[`brand-guidelines.md`](brand-guidelines.md) is the canonical policy for every artifact created in
Titan. The deployment injects it into regular and spawned agent prompts, so new apps, Gadgets,
documents, and exports use it by default.

Titan is the product. Original Pictures is the organization behind it. Apply that distinction
consistently in user-facing copy:

- Product name: **Titan**
- Organization name: **Original Pictures**
- Tagline: **The record behind content**

## Deployed application settings

After deploying, open `/admin` → **General** and set the following runtime settings. They are stored by the application, so they cannot be committed to this deployment wrapper.

| Setting | Value |
| --- | --- |
| Site name | `Titan` |
| Logo | Upload `logo-navy.png` from `https://originalpictures.com/logo-navy.png` |
| Accent color | `#B8922A` |

Use the navy logo as the standard app-chrome logo. The image should be uploaded as a square image (the app scales it to a maximum 256px edge). Use `logo-white.png` only on navy backgrounds, and the brass logo only as a decorative highlight—not as the primary mark.

## UI palette

| Role | Color |
| --- | --- |
| Primary / headings / navigation | Navy `#0D1B2A` |
| Accent / emphasis | Brass `#B8922A` |
| Background | Warm White `#FDFAF5` |
| Card background | Ivory `#F5F0E8` |
| Secondary background / dividers | Stone `#E8E2D8` |
| Supporting text | Slate `#4A6070` |

Keep brass sparse and reserve it for emphasis. Favor navy-and-white contrast, generous whitespace, and clear, readable sans-serif typography.
