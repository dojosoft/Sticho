/**
 * 大文档阅读器：分节渐进渲染 + 视口外虚拟化。
 *
 * 为什么需要它：Vditor 的即时渲染（IR）会把整篇 Markdown 一次性转成「可编辑 DOM」，
 * 每节约 31 个元素（隐藏源码标记、代码块镜像、复制按钮、textarea、行号槽……）。
 * 实测 486KB → 3.5 万节点、主线程阻塞约 28 秒；3MB → 约 22 万节点、主线程永久无响应。
 * 语法高亮只占约 3%，行号栏 / 侧边栏几乎不占——瓶颈就是这个 DOM 本体。
 *
 * 这里的做法（只用于阅读模式的超大文档，编辑模式的通路不变）：
 * 1. 按「顶层 ATX 标题」把 Markdown 切成若干分节——标题一定是安全边界，
 *    不会切进代码围栏、表格或列表内部；
 * 2. 每一节都有一个常驻的外层 div，未渲染时它只有一个「实测高度」的占位高度，
 *    渲染时填入内容并把高度交还给内容本身。因此 DOM 里永远只有 n 个外层 div，
 *    正文节点数恒定在视口附近的几十节，而不是随文件线性膨胀；
 * 3. 占位高度用的就是实测高度，所以挂载 / 卸载前后总高度不变，滚动条位置与
 *    视口内容都不会跳动。
 *
 * 渲染本身是同步的（Lute 转 HTML 很快），但每帧只处理有限的分节，
 * 所以打开 3MB 文档时界面立即可用，内容随滚动逐步补齐。
 */

/**
 * 打开文档时，超过这条线就改走大文档阅读通路（约 256K **字符** / 码元）。
 *
 * 判据是 `text.length`（UTF-16 码元）而非 UTF-8 字节：中文文档按字节算是这里的三倍左右，
 * 但真正决定 DOM 节点量的是文档结构（标题、段落、代码块的数量），字节与码元都只是它的
 * 代理指标，故沿用码元。调用点不要在字节语义下理解这条线。
 */
export const LARGE_DOC_BYTES = 262144;

/** 单个分节的目标上限：顶层切分粒度太粗（或整篇没有标题）时按空行继续细切，字节 */
const SECTION_TARGET_BYTES = 16384;

/**
 * 单个分节的硬上限，字节。
 *
 * 细切优先在空行处下刀（不破坏段落/列表），但纯文本、日志、压缩过的 JSON 这类
 * 「通篇没有空行也没有标题」的文件一个空行都找不到，只按空行切会让整篇退化成
 * 一个大分节，等于没分段（打开照样卡）。所以到量就必须兜底切一刀。
 *
 * 这个上限同时决定「视口外虚拟化的粒度」：分节越高，滚动跨越边界时一次性挂载 /
 * 卸载的正文就越多，停顿越明显。纯文本按每行约 20 字节算，2 倍目标值约 240 行、
 * 5000 像素高，仍远高于视口，粒度已经够细；再小则分节数变多、常驻占位 div 变多。
 */
const SECTION_HARD_BYTES = SECTION_TARGET_BYTES * 2;

/** 视口上下各预渲染这么多倍视口高度 */
const MOUNT_AHEAD = 1;
/** 视口外超过这么多倍视口高度才卸载（比预渲染范围大，避免来回抖动） */
const UNMOUNT_SLACK = 2;
/** 单帧渲染预算（ms）：到点就停，剩下的交给下一帧 */
const FRAME_BUDGET_MS = 8;

/** 未测量分节的初始高度估算（px/字符），首节实测后校准一次即固定 */
const INITIAL_PX_PER_CHAR = 0.55;
const MIN_SECTION_PX = 32;
/** 校准用的最小分节长度（字符），太短的分节测出来的比例不准 */
const CALIBRATE_MIN_CHARS = 400;

export interface LargeReaderDeps {
  /** Markdown → HTML（由 editor.ts 注入 Vditor 的 Lute 实例，保留用户的 markdown 选项） */
  md2html: (md: string) => string;
  /** 对刚挂载的分节做二次装饰：代码高亮/复制按钮、公式、Mermaid、图片解析 */
  decorate: (sectionEl: HTMLElement) => void;
  /**
   * 纯文本模式：源码按原样塞进 `<pre>`，不做任何 Markdown 转换，也不做二次装饰。
   *
   * 超大代码文件（≥ CODE_LARGE_BYTES）走的就是这条通路——`.py` / `.bat` 若交给
   * Lute 按 Markdown 渲染，`#` 会变标题、`*` 会变强调，源码面目全非。纯文本下
   * 每行与源码严格一对一，行号也不会错位。
   */
  plain?: boolean;
  /**
   * 视口附近的分节挂载 / 卸载之后通知一次。
   *
   * 查找高亮登记的是 Range，而 Range 只存在于已挂载的分节里：分节换了一批，
   * 旧的 Range 就指向被清空的占位 div。应用层据此重画一次高亮。
   */
  onRender?: () => void;
}

/** 一个已挂载（DOM 里有真实内容）的分节的对外视图 */
export interface MountedSection {
  el: HTMLElement;
  /** 该节源码起点在整篇源码（LargeReader.sourceText）里的字符偏移 */
  start: number;
  /** 该节源码终点（不含），即下一节的 start */
  end: number;
}

/**
 * 把 Markdown 切成若干分节。
 *
 * 顶层 ATX 标题（`#`~`######` 后跟空白）是唯一的主切分点，且只在代码围栏之外识别，
 * 因此不会把一段代码/表格/引用切坏。切完后若某个分节仍然过大（比如通篇没有标题），
 * 再在围栏外的空行处按目标字节数细切——空行不会出现在表格内部，段落/列表/引用
 * 被切开也只是分成两块，渲染结果与原文一致。
 */
export function splitSections(md: string): string[] {
  const coarse: string[] = [];
  let buf: string[] = [];
  let fence = "";
  const push = (): void => {
    if (buf.length > 0) {
      coarse.push(buf.join("\n"));
      buf = [];
    }
  };
  for (const line of md.split(/\r\n|\r|\n/)) {
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      const mark = fm[1][0];
      if (fence === "") fence = mark;
      else if (mark === fence) fence = "";
    }
    if (fence === "" && /^#{1,6}\s/.test(line) && buf.length > 0) push();
    buf.push(line);
  }
  push();

  const out: string[] = [];
  for (const chunk of coarse) {
    if (chunk.length <= SECTION_TARGET_BYTES * 2) {
      out.push(chunk);
      continue;
    }
    let sub: string[] = [];
    let subFence = "";
    let size = 0;
    const flush = (): void => {
      if (sub.length > 0) out.push(sub.join("\n"));
      sub = [];
      size = 0;
    };
    for (const line of chunk.split(/\r\n|\r|\n/)) {
      const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fm) {
        const mark = fm[1][0];
        if (subFence === "") subFence = mark;
        else if (mark === subFence) subFence = "";
      }
      // 单行就超过硬上限（压缩过的 JSON、超长日志行）：这一行自己就比上限大，
      // 只按行切永远切不动，只能按字符硬切。
      if (subFence === "" && line.length > SECTION_HARD_BYTES) {
        flush();
        for (let at = 0; at < line.length; at += SECTION_HARD_BYTES) {
          out.push(line.slice(at, at + SECTION_HARD_BYTES));
        }
        continue;
      }
      sub.push(line);
      size += line.length + 1;
      // 到量就切：优先在空行处下刀，找不到空行（纯文本 / 日志 / 无空行的源码）
      // 就到硬上限兜底切一刀——否则整篇会退化成一个大分节。
      if (subFence !== "") continue;
      if (line.trim() === "" ? size >= SECTION_TARGET_BYTES : size >= SECTION_HARD_BYTES) flush();
    }
    flush();
  }
  return out;
}

/** 一段文本占的源码行数（分节之间补回的那个换行由调用方各自累加） */
function countLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

/** 数一段 Markdown 里的标题条数（与 splitSections 用同一套判据） */
function countHeadings(text: string): number {
  let n = 0;
  let fence = "";
  for (const line of text.split(/\r\n|\r|\n/)) {
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      const mark = fm[1][0];
      if (fence === "") fence = mark;
      else if (mark === fence) fence = "";
      continue;
    }
    if (fence === "" && /^#{1,6}\s/.test(line)) n += 1;
  }
  return n;
}

export class LargeReader {
  /** 正文根节点：查找/替换与大纲定位都把它当作「编辑器正文」 */
  readonly content: HTMLElement;

  /** 真正承担滚动的容器（行号栏 / 聚光灯要挂在它身上，而不是正文 root 上） */
  readonly scroller: HTMLElement;
  private readonly deps: LargeReaderDeps;
  /** 每一节的常驻外层 div */
  private wrappers: HTMLElement[] = [];
  private sections: string[] = [];
  /** 分节拼接回来的整篇源码：与 sourceStarts / sourceEnds 同一坐标系 */
  private source = "";
  private heights: number[] = [];
  /** 每节起始处的「全局第几个标题」，供大纲定位用 */
  private headingBefore: number[] = [];
  private offsets: number[] = [];
  /** 每节源码起点 / 终点在整篇源码里的字符偏移 */
  private sourceStarts: number[] = [];
  private sourceEnds: number[] = [];
  private mounted = new Set<number>();
  private pxPerChar = INITIAL_PX_PER_CHAR;
  private calibrated = false;
  private frame = 0;
  private disposed = false;
  private readonly onScroll = (): void => this.schedule();

  constructor(scroller: HTMLElement, deps: LargeReaderDeps) {
    this.deps = deps;
    this.scroller = scroller;
    scroller.classList.add("md-large-reader");

    this.content = document.createElement("div");
    this.content.className = "vditor-reset md-large-reader__body";
    // 纯文本模式：正文根上加一层钩子，app.css 靠它把 `<pre>` 的 Vditor 样式还原掉
    if (deps.plain) this.content.classList.add("md-large-reader__body--plain");
    scroller.appendChild(this.content);

    scroller.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll);
  }

  /** 整篇源码（各分节按「\n」拼回来的结果，阅读态下正文不可编辑，与原文等价） */
  get sourceText(): string {
    return this.source;
  }

  /** 当前有真实 DOM 内容的分节（查找高亮只可能落在这里面） */
  mountedSections(): MountedSection[] {
    const out: MountedSection[] = [];
    for (const i of Array.from(this.mounted).sort((a, b) => a - b)) {
      out.push({ el: this.wrappers[i], start: this.sourceStarts[i], end: this.sourceEnds[i] });
    }
    return out;
  }

  /**
   * 定位到源码偏移 offset 所在的分节：把它挂载出来。
   *
   * 查找要「命中整篇」就必须能跳到还没渲染的分节，跳过去的前提是那一节先有 DOM。
   * `holdScroll` 为真时，若目标分节本来就已经挂载，就不把它重新滚到节首——同一节里
   * 可能有多处命中（纯文本一节几万像素、几百处命中），每跳一次都先滚回节首会看到
   * 明显的「跳上去再落回来」，此时交给调用方按命中位置精确滚动。
   */
  revealSourceOffset(offset: number, holdScroll = false): MountedSection | null {
    const n = this.sections.length;
    if (n === 0) return null;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.sourceStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    if (!(holdScroll && this.mounted.has(lo))) this.goto(lo);
    return { el: this.wrappers[lo], start: this.sourceStarts[lo], end: this.sourceEnds[lo] };
  }

  /** 装载一篇新文档（会丢弃上一份的全部状态） */
  load(md: string): void {
    this.sections = splitSections(md);
    const n = this.sections.length;
    this.heights = new Array(n);
    this.headingBefore = new Array(n);
    this.offsets = new Array(n);
    this.sourceStarts = new Array(n);
    this.sourceEnds = new Array(n);
    this.wrappers = new Array(n);
    this.mounted.clear();
    this.pxPerChar = INITIAL_PX_PER_CHAR;
    this.calibrated = false;

    const frag = document.createDocumentFragment();
    let headings = 0;
    let at = 0; // 源码字符偏移
    let line = 0; // 源码行号（0 基）
    for (let i = 0; i < n; i++) {
      const text = this.sections[i];
      const px = Math.max(MIN_SECTION_PX, Math.round(text.length * this.pxPerChar));
      this.heights[i] = px;
      this.headingBefore[i] = headings;
      this.sourceStarts[i] = at;
      this.sourceEnds[i] = at + text.length;
      const el = document.createElement("div");
      el.className = "md-large-reader__section";
      el.dataset.section = String(i);
      // 该节的源码起始行号：行号栏在分节渲染下要靠它把行号接上（见 editor.ts 的 collectLineUnits）
      el.dataset.srcLine = String(line);
      el.style.height = `${px}px`;
      this.wrappers[i] = el;
      frag.appendChild(el);
      headings += countHeadings(text);
      at += text.length + 1; // +1 是分节之间补回的那个换行
      line += countLines(text);
    }
    this.source = this.sections.join("\n");
    this.content.replaceChildren(frag);
    this.recompute();
    this.scroller.scrollTop = 0;
    this.update();
    // 兜底再排一帧：load() 可能发生在滚动容器刚插入、布局还没结算的时候
    // （此时 clientHeight 为 0，update() 的视口范围会退化成一个分节）。
    this.schedule();
  }

  /** 挂载 / 卸载视口附近的分节 */
  private update(): void {
    if (this.disposed) return;
    const n = this.sections.length;
    if (n === 0) return;
    const vh = Math.max(1, this.scroller.clientHeight);
    const top = this.scroller.scrollTop;

    const dropLo = top - vh * (MOUNT_AHEAD + UNMOUNT_SLACK);
    const dropHi = top + vh * (1 + MOUNT_AHEAD + UNMOUNT_SLACK);
    let changed = false;
    for (const i of [...this.mounted]) {
      const start = this.offsets[i];
      if (start + this.heights[i] < dropLo || start > dropHi) {
        this.unmount(i);
        changed = true;
      }
    }

    const from = this.indexAt(top - vh * MOUNT_AHEAD);
    const to = this.indexAt(top + vh * (1 + MOUNT_AHEAD));
    const deadline = performance.now() + FRAME_BUDGET_MS;
    let more = false;
    for (let i = from; i <= to; i++) {
      if (this.disposed) return;
      if (this.mounted.has(i)) continue;
      this.fill(i);
      changed = true;
      // 单帧预算用尽就停手，剩下的分节排到下一帧——必须重新排帧，
      // 否则「视口内还有没填的分节」会一直停留在空白占位上（只在滚动时才再触发）。
      if (performance.now() > deadline) {
        more = i < to;
        break;
      }
    }
    if (more) this.schedule();
    // 分节换了一批：正文里登记的查找高亮 Range 已指向被清空的占位 div，通知应用层重画
    if (changed) this.deps.onRender?.();
  }

  /** 填入一节正文（渲染 → 装饰 → 量实测高度并写回） */
  private fill(i: number): void {
    const el = this.wrappers[i];
    if (!el) return;
    if (this.deps.plain) {
      // 纯文本：一节就是一段原文，包进 <pre> 保住空白与换行（white-space / 字体见 app.css）
      const pre = document.createElement("pre");
      pre.textContent = this.sections[i];
      el.replaceChildren(pre);
    } else {
      el.innerHTML = this.deps.md2html(this.sections[i]);
      this.deps.decorate(el);
    }
    el.style.height = "";
    el.classList.add("is-rendered");
    this.mounted.add(i);
    const real = el.offsetHeight;
    if (real > 0) {
      const prev = this.heights[i];
      this.heights[i] = real;
      // 用实测高度替换占位估算，会让本节之后的所有内容整体位移。若被替换的这节在视口
      // 上方，位移就表现为「读着读着正文自己往上／往下跳」（跳到某节后邻居接连实测，
      // 目标会被推走上千像素就是同一个原因）。把同样的差值补回 scrollTop，视口里的
      // 内容便原地不动——等价于浏览器的原生 scroll anchoring，只是分节高度是我们自己
      // 量的，原生那套认不出来（.md-large-reader 还显式关掉了 overflow-anchor）。
      const shift = real - prev;
      if (shift !== 0 && this.offsets[i] < this.scroller.scrollTop) {
        this.scroller.scrollTop += shift;
      }
      if (!this.calibrated && this.sections[i].length >= CALIBRATE_MIN_CHARS) {
        // 用首个足够长的分节校准估算比例，之后固定，避免占位高度反复变化造成跳动；
        // 同时用它刷新其余尚未实测的占位高度，否则未渲染区域的滚动条长度会差出成倍
        // （实测高度与内容一起收缩会造成滚动跳动）。
        this.calibrated = true;
        this.pxPerChar = Math.min(2, Math.max(0.15, real / this.sections[i].length));
        this.reestimate();
      }
      this.recompute();
    }
  }

  /** 用当前估算比例刷新所有尚未实测（未挂载）分节的占位高度 */
  private reestimate(): void {
    const top = this.scroller.scrollTop;
    let shift = 0;
    for (let i = 0; i < this.sections.length; i++) {
      if (this.mounted.has(i)) continue;
      const prev = this.heights[i];
      const px = Math.max(MIN_SECTION_PX, Math.round(this.sections[i].length * this.pxPerChar));
      if (px === prev) continue;
      this.heights[i] = px;
      this.wrappers[i].style.height = `${px}px`;
      // 一次性刷新几千节的占位高度，视口上方那些变了多少就补回多少，视口内容才不跳
      if (this.offsets[i] < top) shift += px - prev;
    }
    if (shift !== 0) this.scroller.scrollTop = top + shift;
  }

  /** 卸载：清空内容并把高度交还给占位高度（与实测一致，因此总高度不变） */
  private unmount(i: number): void {
    const el = this.wrappers[i];
    this.mounted.delete(i);
    if (!el) return;
    el.classList.remove("is-rendered");
    el.replaceChildren();
    el.style.height = `${this.heights[i]}px`;
  }

  /** 重算前缀和（每帧一次） */
  private recompute(): void {
    let acc = 0;
    for (let i = 0; i < this.heights.length; i++) {
      this.offsets[i] = acc;
      acc += this.heights[i];
    }
  }

  /** 二分找 y 位置落在哪一节 */
  private indexAt(y: number): number {
    const n = this.sections.length;
    if (n === 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, Math.min(n - 1, lo));
  }

  /** 合帧：滚动事件很密，统一到一个 rAF 里处理 */
  private schedule(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  /**
   * 定位到「第 index 个标题」（与侧边栏大纲的序号一致）。
   *
   * 分节起点就是标题，所以直接按每节的标题计数反查即可；若挂载后文字对不上
   * （大纲与源码口径略有差异），退化为在已挂载的正文里按文字匹配。
   */
  scrollToHeading(index: number, text: string): void {
    const n = this.sections.length;
    if (n === 0) return;
    const norm = (v: string): string => v.replace(/\s+/g, " ").trim();
    let target = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (this.headingBefore[i] <= index) {
        target = i;
        break;
      }
    }
    this.goto(target);
    if (!text) return;
    // 校验：定位节里若没有这条标题（大纲口径与源码略有差异，例如标题在引用/列表内），
    // 退化为在源码分节里按标题文字查找——比只在已挂载分节里找可靠得多。
    const want = norm(text);
    const here = Array.from(this.wrappers[target]?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []);
    if (here.some((h) => norm(h.textContent ?? "") === want)) return;
    for (let i = 0; i < n; i++) {
      for (const line of this.sections[i].split(/\r\n|\r|\n/)) {
        const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
        if (m && norm(m[1]) === want) {
          this.goto(i);
          return;
        }
      }
    }
  }

  /** 滚到某一节的顶端（未挂载则先挂载，保证落点高度是实测值） */
  private goto(i: number): void {
    if (!this.mounted.has(i)) this.fill(i);
    this.recompute();
    this.scroller.scrollTop = this.offsets[i];
    this.update();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.scroller.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onScroll);
    this.scroller.classList.remove("md-large-reader");
    this.content.remove();
    this.wrappers = [];
    this.sections = [];
    this.source = "";
    this.heights = [];
    this.sourceStarts = [];
    this.sourceEnds = [];
    this.mounted.clear();
  }
}