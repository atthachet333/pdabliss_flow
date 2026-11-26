/**
 * /dev/design-showcase — DEVELOPMENT ONLY.
 * Loaded lazily and only when import.meta.env.DEV or MODE === 'showcase', so it is
 * excluded from production bundles (verified by scripts/check-showcase-excluded.mjs).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  addDaysToLocalDate,
  buildFlexPreview,
  FLEX_TEMPLATE_IDS,
  toLocalDateString,
  zonedLocalToUtc,
  type FlexPreviewInput,
  type FlexTemplateId,
} from '@flow/shared';
import {
  brand,
  categoryThemes,
  contrastRatio,
  sally as sallyTokens,
  type ThemeId,
} from '@flow/design-system';
import { brandArt, SALLY_EXPRESSION_META, sallyArt, type SallyExpression } from '../brand/assets';
import { ChatPreview } from '../components/FlexBubble';
import {
  Bell,
  CalendarPlus,
  Check,
  LayoutGrid,
  MessageCircle,
  Palette,
  RefreshCw,
  Smartphone,
  Sparkles,
  Type,
  WifiOff,
} from '../components/icons';
import {
  Button,
  CategoryBadge,
  Notice,
  ProtoBadge,
  SallyImage,
  Skeleton,
  StateView,
  Switch,
  When,
} from '../components/ui';
import { MOCK_TIMEZONE } from '../fixtures/mock';
import { useApiStatus } from '../lib/api-status';
import { AppointmentPrototype } from '../prototype/AppointmentPrototype';
import { TodayPrototype } from './TodayPrototype';

export const SHOWCASE_MARKER = 'FLOW_DESIGN_SHOWCASE_DEV_ONLY';

const SECTIONS = [
  { id: 'identity', letter: 'A', label: 'Identity', th: 'ตัวตนแบรนด์' },
  { id: 'sally', letter: 'B', label: 'Sally', th: 'มาสคอต' },
  { id: 'foundations', letter: 'C', label: 'Color & Type', th: 'สีและตัวอักษร' },
  { id: 'components', letter: 'D', label: 'Components', th: 'คอมโพเนนต์' },
  { id: 'rich-menu', letter: 'E', label: 'Rich Menu', th: 'ริชเมนู' },
  { id: 'templates', letter: 'F', label: 'Notifications', th: 'เทมเพลตแจ้งเตือน' },
  { id: 'today', letter: 'G', label: 'Today', th: 'หน้าวันนี้' },
  { id: 'create', letter: 'H–J', label: 'Create', th: 'สร้างนัดหมาย' },
  { id: 'states', letter: 'K', label: 'States', th: 'สถานะต่างๆ' },
] as const;

function SectionHead({
  id,
  icon: Icon,
  title,
  lead,
}: {
  id: string;
  icon: typeof Palette;
  title: string;
  lead: string;
}) {
  const s = SECTIONS.find((x) => x.id === id);
  return (
    <header className="sc-head">
      <p className="f-eyebrow">
        <Icon aria-hidden className="inline-icon" /> {s?.letter} · {s?.label}
      </p>
      <h2>{title}</h2>
      <p className="sc-lead">{lead}</p>
    </header>
  );
}

// ------------------------------------------------------------------- A
function IdentitySection() {
  return (
    <section id="identity" className="sc-section sc-identity" aria-labelledby="identity-title">
      <div className="sc-identity__inner">
        <img src={brandArt.flowWordmarkIvory} alt="FLOW" className="sc-identity__wordmark" />
        <p className="sc-identity__statement">THE INTELLIGENCE OF EVERYDAY LIFE</p>
        <h1 id="identity-title" className="sc-identity__tagline">
          ทุกนัดหมาย ถูกเวลา ถูกคน ถูกกลุ่ม
        </h1>
        <div className="sc-identity__sally">
          <SallyImage variant="avatar" size={72} decorative />
          <p>
            <span className="sc-identity__quote">“เรื่องเวลาปล่อยให้ Sally ดูแลนะคะ”</span>
            <span className="sc-identity__who">น้องแซลลี่ · ผู้ช่วยนัดหมายใน LINE</span>
          </p>
        </div>
        <dl className="sc-identity__facts">
          <div>
            <dt>Product</dt>
            <dd>PDA BLISS FLOW</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>Shared Calendar &amp; LINE Personal Assistant</dd>
          </div>
          <div>
            <dt>Direction</dt>
            <dd>Luxury Tech × Friendly Assistant × Editorial Minimalism</dd>
          </div>
        </dl>
        <p className="sc-identity__sig">Designed &amp; Engineered by PDA BLISS</p>
      </div>
      <div className="sc-identity__marks">
        <figure>
          <img src={brandArt.flowSymbol} alt="FLOW symbol" width={96} height={96} />
          <figcaption>Symbol · time ring + F</figcaption>
        </figure>
        <figure className="is-light">
          <img src={brandArt.flowLockup} alt="FLOW lockup" />
          <figcaption>Lockup</figcaption>
        </figure>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- B
function SallySection() {
  const expressions = Object.keys(sallyArt) as SallyExpression[];
  return (
    <section id="sally" className="sc-section" aria-labelledby="sally-h">
      <SectionHead
        id="sally"
        icon={Sparkles}
        title="Sally · น้องแซลลี่"
        lead="มาสคอตรถยนต์น่ารักแบบออริจินัลของ FLOW — Cute × Premium × Friendly สีฟ้าพาสเทล ตาโตสีมรกต มงกุฎนาฬิกา หูฟังปฏิทิน และไฟหน้ารูปหัวใจ"
      />
      <h3 id="sally-h" className="f-sr-only">
        Sally
      </h3>
      <div className="sally-hero">
        <figure className="sally-hero__ref">
          <SallyImage variant="portrait" size={360} />
          <figcaption>
            <strong>ภาพอ้างอิงที่เจ้าของอนุมัติ (canonical)</strong>
            <span className="f-hint">ใช้กับพื้นที่ที่เน้นตัวตน: หน้าต้อนรับ, รูปโปรไฟล์, About</span>
          </figcaption>
        </figure>
        <div className="sally-hero__notes">
          <p className="f-eyebrow">Character sheet</p>
          <ul className="sally-traits">
            <li>รถคอมแพกต์ทรงมน สีฟ้าพาสเทล รายละเอียดสีเงินและมรกต</li>
            <li>ใบหน้าบนกระจกหน้า ดวงตาโตสีมรกตพร้อมประกายรูปหัวใจ</li>
            <li>มงกุฎนาฬิกาสีเงิน + วงแหวนแสงสีมิ้นต์ (สัญลักษณ์เวลา)</li>
            <li>หูฟังมรกต — ฝั่งขวามีไอคอนปฏิทินติ๊กถูก</li>
            <li>โบว์มรกตพร้อมอัญมณีหัวใจ · ไฟหน้ารูปหัวใจเรืองแสง</li>
            <li>ป้ายทะเบียน FLOW · ไม่มีโลโก้หรืองานศิลป์ของบุคคลที่สาม</li>
          </ul>
          <div className="sally-sizes" aria-label="ขนาดเล็กสำหรับโปรไฟล์และการแจ้งเตือน">
            {[96, 64, 40, 32].map((s) => (
              <figure key={s}>
                <SallyImage variant="avatar" size={s} decorative />
                <figcaption className="f-num">{s}px</figcaption>
              </figure>
            ))}
          </div>
          <p className="f-hint">
            อวตาร (ครอปจากภาพอ้างอิง) ยังจำได้ที่ 32px — ใช้เป็นรูปผู้ส่งในแชทและโปรไฟล์ LINE
          </p>
        </div>
      </div>
      <p className="sc-sub">อารมณ์ทั้ง 6 แบบ (เวกเตอร์ ตามภาพอ้างอิง)</p>
      <div className="sally-grid">
        {expressions.map((e) => (
          <figure key={e} className="sally-card">
            <SallyImage expression={e} size={128} />
            <figcaption>
              <strong>{SALLY_EXPRESSION_META[e].th}</strong>
              <span className="f-hint">{SALLY_EXPRESSION_META[e].use}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="voice">
        <p className="voice__title">น้ำเสียงของ Sally</p>
        <ul>
          <li>สวัสดีค่ะ Sally มารายงานตัวแล้ว วันนี้มีอะไรให้ช่วยดูแลไหมคะ</li>
          <li>อีก 30 นาทีจะถึงเวลานัดหมายแล้วนะคะ</li>
          <li>อีก 15 นาทีจะเริ่มประชุมค่ะ กรุณาเตรียมตัวให้พร้อมนะคะ</li>
          <li>วันนี้ยังไม่มีนัดหมายค่ะ ใช้เวลากับสิ่งที่สำคัญได้เต็มที่เลยนะคะ</li>
          <li>ขออภัยค่ะ Sally ยังไม่สามารถดำเนินการรายการนี้ได้ กรุณาลองใหม่อีกครั้งนะคะ</li>
        </ul>
        <Notice tone="info">
          Sally จะพูดว่า “บันทึกเรียบร้อยแล้ว” หรือ “ส่งแล้ว” เฉพาะเมื่อการดำเนินการสำเร็จจริงเท่านั้น
        </Notice>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- C
const PALETTE: { name: string; hex: string; note?: string }[] = [
  { name: 'Deep Forest', hex: brand.forest },
  { name: 'Emerald', hex: brand.emerald, note: 'ปุ่มหลัก (ตัวอักษรขาว)' },
  { name: 'Emerald 700', hex: brand.emerald700, note: 'เพิ่มใน EP00: ข้อความ/ลิงก์' },
  { name: 'Soft Mint', hex: brand.mint },
  { name: 'Ivory', hex: brand.ivory },
  { name: 'Graphite', hex: brand.graphite },
  { name: 'Sally Blue', hex: sallyTokens.blue },
  { name: 'Ice Blue', hex: sallyTokens.ice },
  { name: 'Metallic Silver', hex: sallyTokens.silver },
  { name: 'Deep Blue', hex: sallyTokens.deepBlue },
  { name: 'Muted Blue', hex: sallyTokens.mutedBlue, note: 'ตกแต่งเท่านั้น' },
];

function readableOn(hex: string) {
  return contrastRatio(hex, '#FFFFFF') >= 4.5 ? '#FFFFFF' : brand.forest;
}

function FoundationsSection() {
  const themes = [
    'family',
    'business',
    'personal',
    'health',
    'special',
    'urgent',
  ] as const satisfies readonly ThemeId[];
  return (
    <section id="foundations" className="sc-section" aria-labelledby="foundations-h">
      <SectionHead
        id="foundations"
        icon={Palette}
        title="สีและตัวอักษร"
        lead="ไอวอรีอบอุ่น ฟอเรสต์ลึก มรกตเป็นจุดเน้น และฟ้าซิลเวอร์ของ Sally — ทุกคู่สีข้อความผ่าน WCAG AA"
      />
      <h3 id="foundations-h" className="sc-sub">
        Palette
      </h3>
      <div className="swatches">
        {PALETTE.map((p) => (
          <div key={p.name} className="swatch">
            <span className="swatch__chip" style={{ background: p.hex, color: readableOn(p.hex) }}>
              Aa
            </span>
            <span className="swatch__name">{p.name}</span>
            <span className="swatch__hex f-num">{p.hex}</span>
            {p.note ? <span className="f-hint">{p.note}</span> : null}
          </div>
        ))}
      </div>

      <h3 className="sc-sub">Category themes</h3>
      <div className="themes">
        {themes.map((t) => (
          <div key={t} className="theme-card" data-theme={t}>
            <div className="theme-card__band">
              <CategoryBadge category={t} solid />
              <span className="f-num theme-card__ratio">
                {contrastRatio(categoryThemes[t].accent, '#FFFFFF').toFixed(1)}:1
              </span>
            </div>
            <p className="theme-card__ink">ข้อความบนพื้นอ่อน</p>
            <p className="f-num theme-card__ratio">
              {contrastRatio(categoryThemes[t].ink, categoryThemes[t].tint).toFixed(1)}:1
            </p>
          </div>
        ))}
      </div>
      <p className="f-hint">ไม่สื่อความหมายด้วยสีอย่างเดียว — ทุกหมวดมีไอคอนและป้ายข้อความเสมอ</p>

      <h3 className="sc-sub">Typography · IBM Plex Sans Thai (SIL OFL 1.1, self-hosted)</h3>
      <div className="type-specimen">
        <p className="type-specimen__display">นัดหมายสำคัญ ถูกเวลา</p>
        <p className="type-specimen__h">ประชุมผู้บริหาร ไตรมาสที่ ๔</p>
        <p className="type-specimen__body">
          ตรวจสุขภาพประจำปีที่คลินิก ชั้น ๒ — ญาติผู้ใหญ่ ปฏิบัติตามคำแนะนำ ฎีกา ฐาน ผู้ใช้ทุกวัยอ่านได้สบายตา
          ทดสอบสระบนล่างและวรรณยุกต์: กี่ ก็ ปี่ ฟุ้ง ปู่ ญู่ ฏุ ฐู
        </p>
        <p className="type-specimen__nums f-num">09:00 10:30 18:45 · 26/11/2569</p>
        <p className="type-specimen__en">The intelligence of everyday life — FLOW by PDA BLISS</p>
        <p className="f-hint">
          ตัวเลขเวลาเป็น tabular numerals · ระยะบรรทัด 1.65 ป้องกันสระและวรรณยุกต์ถูกตัด · ขนาดเล็กสุด 13px
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- D
function ComponentsSection() {
  const [seg, setSeg] = useState<'day' | 'week' | 'month'>('day');
  const [sw, setSw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<string[]>(['family']);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 1600);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <section id="components" className="sc-section" aria-labelledby="components-h">
      <SectionHead
        id="components"
        icon={LayoutGrid}
        title="คอมโพเนนต์พื้นฐาน"
        lead="ปุ่ม ฟอร์ม ชิปกลุ่ม ป้ายหมวด และวันเวลา — ขนาดแตะขั้นต่ำ 44px และมีวงโฟกัสชัดเจน"
      />
      <h3 id="components-h" className="f-sr-only">
        Components
      </h3>
      <div className="comp-grid">
        <div className="f-card comp">
          <p className="comp__label">Buttons</p>
          <div className="comp__row">
            <Button variant="create" icon={CalendarPlus}>
              เพิ่มนัดหมาย
            </Button>
            <Button variant="primary" icon={Check}>
              ยืนยัน
            </Button>
            <Button>ยกเลิก</Button>
            <Button variant="ghost">ดูทั้งหมด</Button>
          </div>
          <div className="comp__row">
            <Button variant="dark" size="sm">
              ปุ่มเล็ก
            </Button>
            <Button variant="danger" size="sm">
              ลบนัดหมาย
            </Button>
            <Button disabled size="sm">
              ปิดใช้งาน
            </Button>
            <Button variant="primary" size="sm" busy={busy} onClick={() => setBusy(true)}>
              {busy ? 'กำลังโหลด' : 'ทดลองสถานะโหลด'}
            </Button>
          </div>
        </div>

        <div className="f-card comp">
          <p className="comp__label">Inputs</p>
          <div className="f-field">
            <label className="f-label" htmlFor="demo-input">
              ชื่อนัดหมาย
            </label>
            <input id="demo-input" className="f-input" placeholder="เช่น ประชุมพนักงาน" />
          </div>
          <div className="f-field">
            <label className="f-label" htmlFor="demo-select">
              หมวดนัดหมาย
            </label>
            <select id="demo-select" className="f-select" defaultValue="business">
              <option value="family">ครอบครัว</option>
              <option value="business">งานบริษัท</option>
              <option value="health">สุขภาพ</option>
            </select>
          </div>
          <div className="f-field">
            <label className="f-label" htmlFor="demo-invalid">
              ตัวอย่างข้อผิดพลาด
            </label>
            <input
              id="demo-invalid"
              className="f-input"
              aria-invalid
              defaultValue=""
              aria-describedby="demo-invalid-err"
            />
            <p className="f-error" id="demo-invalid-err">
              กรุณาระบุชื่อนัดหมาย
            </p>
          </div>
        </div>

        <div className="f-card comp">
          <p className="comp__label">Group chips · Category · Toggle</p>
          <div className="comp__row" role="group" aria-label="ตัวอย่างชิปกลุ่ม">
            {[
              { id: 'family', label: 'ครอบครัว', meta: '4 คน' },
              { id: 'team', label: 'ทีมงาน', meta: '18 คน' },
              { id: 'exec', label: 'ผู้บริหาร', meta: '5 คน' },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                className="f-chip"
                aria-pressed={chips.includes(c.id)}
                onClick={() =>
                  setChips((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))
                }
              >
                {c.label} <span className="f-chip__meta">{c.meta}</span>
              </button>
            ))}
          </div>
          <div className="comp__row">
            {(['family', 'business', 'personal', 'health', 'special', 'urgent'] as const).map(
              (c) => (
                <CategoryBadge key={c} category={c} />
              ),
            )}
          </div>
          <div className="f-seg" role="group" aria-label="มุมมอง">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={seg === v} onClick={() => setSeg(v)}>
                {v === 'day' ? 'วัน' : v === 'week' ? 'สัปดาห์' : 'เดือน'}
              </button>
            ))}
          </div>
          <Switch checked={sw} onChange={setSw} label="แจ้งสรุปประจำวัน" hint="ทุกเช้า 07:30 น." />
        </div>

        <div className="f-card comp">
          <p className="comp__label">Date &amp; time</p>
          <When time="09:00 น." date="ศ. 27 พ.ย. 2569" timing="อีก 30 นาที" />
          <When time="ทั้งวัน" date="ส. 28 พ.ย. 2569" />
          <p className="comp__label">Notices</p>
          <Notice tone="info">ข้อความในกลุ่มสมาชิกทุกคนจะเห็น</Notice>
          <Notice tone="caution">โควตาข้อความใกล้หมด</Notice>
          <Notice tone="block">Sally ถูกนำออกจากกลุ่มนี้ จึงแจ้งเตือนไม่ได้</Notice>
          <Notice tone="success">เชื่อมต่อ API สำเร็จ</Notice>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- E
const RICH_MENU_MAP = [
  { area: 'A', th: 'วันนี้', route: '/today', bounds: '0,0 · 833×843' },
  { area: 'B', th: 'เพิ่มนัดหมาย', route: '/appointments/new', bounds: '833,0 · 834×843' },
  { area: 'C', th: 'ปฏิทิน', route: '/calendar', bounds: '1667,0 · 833×843' },
  { area: 'D', th: 'กลุ่มของฉัน', route: '/groups', bounds: '0,843 · 833×843' },
  { area: 'E', th: 'ประวัติ', route: '/history', bounds: '833,843 · 834×843' },
  { area: 'F', th: 'ตั้งค่า', route: '/settings', bounds: '1667,843 · 833×843' },
];

function RichMenuSection() {
  return (
    <section id="rich-menu" className="sc-section" aria-labelledby="rich-menu-h">
      <SectionHead
        id="rich-menu"
        icon={Smartphone}
        title="LINE Rich Menu (ต้นแบบ)"
        lead="6 คำสั่งหลัก ปุ่ม “เพิ่มนัดหมาย” เด่นที่สุด ป้ายภาษาไทยอ่านง่ายบนจอมือถือจริง — ยังไม่อัปโหลดเข้า LINE"
      />
      <h3 id="rich-menu-h" className="f-sr-only">
        Rich menu
      </h3>
      <div className="rm">
        <div className="phone phone--rm">
          <div className="phone__chat">
            <div className="phone__bubble">สวัสดีค่ะ Sally มารายงานตัวแล้ว วันนี้มีอะไรให้ช่วยดูแลไหมคะ</div>
          </div>
          <img
            src={brandArt.richMenuConcept}
            alt="ริชเมนู FLOW: วันนี้ เพิ่มนัดหมาย ปฏิทิน กลุ่มของฉัน ประวัติ ตั้งค่า"
            className="rm__img"
          />
          <div className="phone__chatbar">เมนู FLOW ▾</div>
        </div>
        <div className="rm__spec">
          <table className="spec-table">
            <caption>การแมปพื้นที่แตะ → หน้า LIFF (ภาพ 2500×1686)</caption>
            <thead>
              <tr>
                <th scope="col" style={{ whiteSpace: 'nowrap' }}>
                  พื้นที่
                </th>
                <th scope="col">คำสั่ง</th>
                <th scope="col">เส้นทาง</th>
                <th scope="col">ขอบเขต (px)</th>
              </tr>
            </thead>
            <tbody>
              {RICH_MENU_MAP.map((r) => (
                <tr key={r.area}>
                  <td>{r.area}</td>
                  <td>{r.th}</td>
                  <td>
                    <code>{r.route}</code>
                  </td>
                  <td className="f-num">{r.bounds}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Notice tone="info">
            สเปกส่งออก: PNG/JPEG ≤ 1 MB ขนาด 2500×1686 — ไฟล์ต้นฉบับ <code>assets/rich-menu/</code> ·
            อัปโหลดจริงใน EP05 หลังเจ้าของอนุมัติ
          </Notice>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- F
function sampleTemplates(now: Date) {
  const today = toLocalDateString(now, MOCK_TIMEZONE);
  const tomorrow = addDaysToLocalDate(today, 1);
  const at = (d: string, t: string) => zonedLocalToUtc(d, t, MOCK_TIMEZONE);
  const base = { timeZone: MOCK_TIMEZONE, now, allDay: false } as const;
  const inputs: Record<FlexTemplateId, FlexPreviewInput> = {
    family: {
      ...base,
      templateId: 'family',
      category: 'family',
      title: 'นัดพาคุณแม่ไปตรวจตา (ตัวอย่าง)',
      localDate: tomorrow,
      start: at(tomorrow, '10:00'),
      location: 'โรงพยาบาลตัวอย่าง',
      destination: { displayName: 'ครอบครัว (ตัวอย่าง)', kind: 'line-group' },
      reminderOffsetMinutes: 60,
    },
    business: {
      ...base,
      templateId: 'business',
      category: 'business',
      title: 'ประชุมพนักงานประจำเดือน',
      localDate: tomorrow,
      start: at(tomorrow, '09:30'),
      location: 'ห้องประชุมใหญ่ ชั้น 3',
      destination: { displayName: 'ทีมงานบริษัท (ตัวอย่าง)', kind: 'line-group' },
      reminderOffsetMinutes: 15,
    },
    personal: {
      ...base,
      templateId: 'personal',
      category: 'personal',
      title: 'เรียน Network',
      localDate: tomorrow,
      start: at(tomorrow, '19:00'),
      destination: { displayName: 'คุณ', kind: 'private-self' },
      reminderOffsetMinutes: 30,
    },
    health: {
      ...base,
      templateId: 'health',
      category: 'health',
      title: 'นัดหาหมอ (ตัวอย่าง)',
      localDate: tomorrow,
      start: at(tomorrow, '09:00'),
      location: 'คลินิกตัวอย่าง',
      destination: { displayName: 'ครอบครัว (ตัวอย่าง)', kind: 'line-group' },
      reminderOffsetMinutes: 120,
      minimalDisclosure: true,
    },
    special: {
      ...base,
      templateId: 'special',
      category: 'special',
      title: 'วันครบรอบแต่งงาน',
      localDate: tomorrow,
      allDay: true,
      start: at(tomorrow, '08:00'),
      destination: { displayName: 'คุณ', kind: 'private-self' },
      reminderOffsetMinutes: 1440,
    },
    urgent: {
      ...base,
      templateId: 'urgent',
      category: 'urgent',
      title: 'ยื่นเอกสารภาษีก่อนกำหนด',
      localDate: tomorrow,
      start: at(tomorrow, '16:00'),
      destination: { displayName: 'ผู้บริหาร (ตัวอย่าง)', kind: 'line-group' },
      reminderOffsetMinutes: 60,
    },
    changed: {
      ...base,
      templateId: 'changed',
      category: 'business',
      title: 'ประชุมพนักงานประจำเดือน',
      localDate: tomorrow,
      start: at(tomorrow, '13:30'),
      previous: { localDate: tomorrow, start: at(tomorrow, '09:30'), allDay: false },
      destination: { displayName: 'ทีมงานบริษัท (ตัวอย่าง)', kind: 'line-group' },
    },
    cancelled: {
      ...base,
      templateId: 'cancelled',
      category: 'personal',
      title: 'นัดทานข้าวกับเพื่อน',
      localDate: tomorrow,
      start: at(tomorrow, '18:30'),
      destination: { displayName: 'คุณ', kind: 'private-self' },
    },
    'daily-summary': {
      ...base,
      templateId: 'daily-summary',
      category: 'business',
      title: '',
      localDate: today,
      start: at(today, '07:30'),
      destination: { displayName: 'คุณ', kind: 'private-self' },
      summaryItems: [
        { timeText: '09:30', title: 'ประชุมทีมประจำสัปดาห์', category: 'business' },
        { timeText: '13:00', title: 'รับเอกสารที่สำนักงานเขต', category: 'personal' },
        { timeText: '16:30', title: 'ตรวจสุขภาพประจำปี', category: 'health' },
      ],
    },
    saved: {
      ...base,
      templateId: 'saved',
      category: 'personal',
      title: 'เรียน Network',
      localDate: tomorrow,
      start: at(tomorrow, '19:00'),
      destination: { displayName: 'คุณ', kind: 'private-self' },
    },
  };
  return FLEX_TEMPLATE_IDS.map((id) => ({ id, model: buildFlexPreview(inputs[id]) }));
}

const TEMPLATE_TH: Record<FlexTemplateId, string> = {
  family: '1 · ครอบครัว',
  business: '2 · ประชุมบริษัท',
  personal: '3 · ส่วนตัว',
  health: '4 · สุขภาพ (แจ้งแบบย่อ)',
  special: '5 · โอกาสพิเศษ',
  urgent: '6 · ด่วน',
  changed: '7 · มีการเปลี่ยนแปลง',
  cancelled: '8 · ยกเลิก',
  'daily-summary': '9 · สรุปประจำวัน',
  saved: '10 · ยืนยันการบันทึก',
};

function TemplatesSection() {
  const [now] = useState(() => new Date());
  const items = useMemo(() => sampleTemplates(now), [now]);
  return (
    <section id="templates" className="sc-section" aria-labelledby="templates-h">
      <SectionHead
        id="templates"
        icon={MessageCircle}
        title="เทมเพลตการแจ้งเตือน (Flex Message)"
        lead="ลำดับข้อมูล: อะไร → เมื่อไร → ทำอะไรต่อ ใช้เฉพาะองค์ประกอบที่ Flex Message รองรับจริง ข้อมูลสำคัญอยู่ในข้อความ ไม่ขึ้นกับรูปภาพ"
      />
      <h3 id="templates-h" className="f-sr-only">
        Templates
      </h3>
      <div className="tpl-grid">
        {items.map(({ id, model }) => (
          <div key={id} className="tpl">
            <p className="tpl__label">
              <span>{TEMPLATE_TH[id]}</span>
              <code>{id}</code>
            </p>
            <ChatPreview model={model} />
            <details className="tpl__alt">
              <summary>ข้อความสำรอง (alt text)</summary>
              <p>{model.altText}</p>
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- K
function StatesSection() {
  const { status, recheck } = useApiStatus();
  return (
    <section id="states" className="sc-section" aria-labelledby="states-h">
      <SectionHead
        id="states"
        icon={Bell}
        title="สถานะว่าง โหลด ผิดพลาด และยืนยัน"
        lead="ทุกสถานะบอกความจริง — ไม่มีสัญลักษณ์สำเร็จปลอม"
      />
      <h3 id="states-h" className="f-sr-only">
        States
      </h3>
      <div className="states-grid">
        <div className="f-card">
          <p className="comp__label">Empty</p>
          <StateView
            expression="empty"
            title="วันนี้ยังไม่มีนัดหมายค่ะ"
            body="ใช้เวลากับสิ่งที่สำคัญได้เต็มที่เลยนะคะ"
          />
        </div>
        <div className="f-card">
          <p className="comp__label">Loading</p>
          <div className="loading-demo" aria-busy="true" aria-label="กำลังโหลดนัดหมาย">
            <div className="loading-demo__sally">
              <SallyImage expression="thoughtful" size={56} decorative />
              <p className="f-muted">Sally กำลังเตรียมตารางให้ค่ะ…</p>
            </div>
            <Skeleton height={20} width="60%" />
            <Skeleton height={64} radius={14} />
            <Skeleton height={64} radius={14} />
          </div>
        </div>
        <div className="f-card">
          <p className="comp__label">Error</p>
          <StateView
            expression="error"
            title="ขออภัยค่ะ Sally ยังไม่สามารถดำเนินการรายการนี้ได้"
            body="กรุณาลองใหม่อีกครั้งนะคะ หากยังไม่ได้ โปรดแจ้งผู้ดูแลระบบ"
            action={<Button icon={RefreshCw}>ลองอีกครั้ง</Button>}
          />
        </div>
        <div className="f-card">
          <p className="comp__label">Live API status (จริง ไม่ใช่ข้อมูลจำลอง)</p>
          {status.state === 'checking' ? (
            <div className="api-status">
              <Skeleton height={18} width="70%" />
              <p className="f-hint">กำลังตรวจสอบ GET /health …</p>
            </div>
          ) : status.state === 'online' ? (
            <div className="api-status">
              <Notice tone="success">
                API ตอบกลับจริงจาก <code>/health</code> · {status.service}
              </Notice>
              <Button size="sm" icon={RefreshCw} onClick={() => void recheck()}>
                ตรวจอีกครั้ง
              </Button>
            </div>
          ) : (
            <div className="api-status">
              <StateView
                expression="error"
                title="ยังเชื่อมต่อ API ไม่ได้"
                body={`${status.reason} — เปิด npm run dev เพื่อเริ่ม API ที่พอร์ต 6768`}
              />
              <Button size="sm" icon={WifiOff} onClick={() => void recheck()}>
                ลองเชื่อมต่อใหม่
              </Button>
            </div>
          )}
        </div>
        <div className="f-card">
          <p className="comp__label">Confirmation (prototype)</p>
          <div className="confirm-demo">
            <SallyImage expression="happy" size={72} decorative />
            <p className="f-state__title">Sally บันทึกนัดหมายให้เรียบร้อยแล้วค่ะ</p>
            <ProtoBadge>ตัวอย่างข้อความ — แสดงจริงเฉพาะหลังบันทึกสำเร็จ (EP03)</ProtoBadge>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- page shell
export default function DesignShowcase() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Design Showcase (DEV) · FLOW';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="sc" data-marker={SHOWCASE_MARKER}>
      <div className="sc-devbar" role="note">
        <strong>DEV ONLY</strong>
        <span>Design Showcase · EP00 · ข้อมูลทั้งหมดเป็นข้อมูลจำลอง ไม่มีการบันทึกหรือส่ง LINE</span>
      </div>
      <nav className="sc-nav" aria-label="ส่วนต่างๆ ของ showcase">
        <img src={brandArt.flowLockup} alt="PDA BLISS FLOW" className="sc-nav__logo" />
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                <span className="sc-nav__letter">{s.letter}</span>
                <span className="sc-nav__label">{s.th}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <main className="sc-main">
        <IdentitySection />
        <SallySection />
        <FoundationsSection />
        <ComponentsSection />
        <RichMenuSection />
        <TemplatesSection />
        <section id="today" className="sc-section" aria-labelledby="today-h">
          <SectionHead
            id="today"
            icon={Type}
            title="หน้าวันนี้ (Today dashboard)"
            lead="ทักทายจาก Sally นัดถัดไป รายการวันนี้แบบไทม์ไลน์ และตัวกรองกลุ่ม — ไม่หนาแน่นแบบแดชบอร์ดวิเคราะห์"
          />
          <h3 id="today-h" className="f-sr-only">
            Today
          </h3>
          <div className="today-pair">
            <div className="phone">
              <TodayPrototype />
            </div>
            <div className="phone">
              <TodayPrototype forceEmpty />
            </div>
          </div>
        </section>
        <section id="create" className="sc-section" aria-labelledby="create-h">
          <SectionHead
            id="create"
            icon={CalendarPlus}
            title="สร้างนัดหมาย · เลือกกลุ่ม · ตัวอย่างสด"
            lead="ลองพิมพ์ชื่อ เปลี่ยนหมวด เวลา และปลายทาง — ตัวอย่างข้อความ เวลาแจ้งเตือนจริง และโควตาเปลี่ยนทันที"
          />
          <h3 id="create-h" className="f-sr-only">
            Create appointment
          </h3>
          <AppointmentPrototype />
        </section>
        <StatesSection />
        <footer className="sc-footer">
          <img src={brandArt.flowSymbol} alt="" width={32} height={32} aria-hidden />
          <p>PDA BLISS FLOW · EP00 foundation · Designed &amp; Engineered by PDA BLISS</p>
        </footer>
      </main>
    </div>
  );
}
