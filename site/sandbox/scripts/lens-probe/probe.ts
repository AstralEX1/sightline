// Runs inside the Even Hub simulator. Polls lens-font.ts for a page (the JSON the sandbox's Lens takes), shows it,
// sends its images, then says so; lens-font.ts takes the screenshot.
import {
  waitForEvenAppBridge, CreateStartUpPageContainer, RebuildPageContainer, TextContainerProperty, ImageContainerProperty,
  ImageRawDataUpdate, MenuContainerProperty, MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import type { Page } from '../../src/lens.ts'

type Job = { seq: number; page: Page; images?: Record<string, number[]> }

const bridge = await waitForEvenAppBridge()
let started = false

async function show({ page: p, images }: Job): Promise<string> {
  const page = {
    containerTotalNum: (p.textObject?.length ?? 0) + (p.imageObject?.length ?? 0),
    textObject: p.textObject?.map(t => new TextContainerProperty(t)),
    imageObject: p.imageObject?.map(i => new ImageContainerProperty(i)),
    menuObject: p.menuObject && new MenuContainerProperty({ menuItems: p.menuObject.menuItems?.map(m => new MenuItemProperty(m)) }),
  }
  // A reload of this page finds the start-up page already made: rebuild then, as the app does.
  const made = !started && (await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))) === 0
  started = true
  if (!made && !(await bridge.rebuildPageContainer(new RebuildPageContainer(page)))) return 'page rejected'
  for (const [name, png] of Object.entries(images ?? {})) {
    const box = p.imageObject?.find(i => i.containerName === name)
    const result = box && await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: box.containerID, containerName: name, imageData: png }))
    if (result !== 'success') return `image ${name}: ${result}`
  }
  return ''
}

let seq = -1
for (;;) {
  const job = await fetch('/probe/job').then(r => r.json() as Promise<Job>, () => null)
  if (job && job.seq !== seq) {
    seq = job.seq
    // The simulator does not answer some pages at all: say so rather than wait forever.
    const late = new Promise<string>(r => setTimeout(() => r('no reply from the simulator'), 8000))
    const error = await Promise.race([show(job).catch((e: unknown) => String(e)), late])
    await fetch('/probe/shown', { method: 'POST', body: JSON.stringify({ seq, error }) })
  }
  await new Promise(r => setTimeout(r, 150))
}
