# Credits and licences

## Heart knowledge and content

The heart view was built for this project from two sources: the reading list in the `heart-knowledge-hub` project (`repos/`, `linked-papers-and-articles/` and `docs/external-resources.md` in that repository), and the cardiac anatomy and physiology outline supplied with the brief. Descriptions in `apps/web/data/heart/*.json` were written for this app in plain language rather than copied from any single text. References that the outline and the hub's list rest on include:

- OpenStax, *Anatomy and Physiology 2e* (CC BY 4.0) — chamber, valve, vessel and conduction-system anatomy.
- StatPearls (NCBI Bookshelf) — cardiac cycle, coronary circulation, ECG intervals and pharmacology summaries.
- American Heart Association statistical updates — resting heart rate, stroke volume, cardiac output and blood-pressure ranges.
- Wiggers, C. J. (1928), *The Pressure Pulses in the Cardiovascular System* — the pressure–volume sequence the cycle panel illustrates.
- Guyton & Hall, *Textbook of Medical Physiology* — Frank–Starling, preload/afterload and autonomic control.

Physiology values are population averages for teaching. They are not patient data and are not suitable for clinical use. The app shows the disclaimer "Educational simulator. Population-average estimate. Not medical or dosing advice." on every route.

## 3D assets

- **BodyParts3D**, © The Database Center for Life Science, licensed under [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en). The existing body model in `apps/web/public/models` and its provenance files in `assets/anatomy/` come from this release; see [assets/anatomy/README.md](assets/anatomy/README.md#licence).
- **Heart simulator geometry is original and procedural.** It is generated at runtime from lofted chamber shapes, swept valve leaflets and tapered tubes along splines in `apps/web/components/heart/geometry.ts`. It is not derived from, and does not redistribute, any third-party heart mesh, so no additional attribution is required for it. Anatomical proportions were checked against the BodyParts3D reference and the sources above.

## Software

| Component | Licence |
| --- | --- |
| [three.js](https://threejs.org) | MIT |
| [Next.js](https://nextjs.org) and [React](https://react.dev) | MIT |
| [Tailwind CSS](https://tailwindcss.com) | MIT |
| [lucide-react](https://lucide.dev) | ISC |
| [Vitest](https://vitest.dev) | MIT |

## Sound

The S1 and S2 heart sounds are synthesised in the browser with the Web Audio API (two short, enveloped oscillators). No recorded audio is bundled, so no audio licence applies.

## Adding assets

If you replace the procedural heart with a downloaded mesh, record here: the model name, author, source URL, licence, the date you obtained it, and any changes you made. Meshes whose licence forbids redistribution, or that require attribution you cannot satisfy, must not be committed.
