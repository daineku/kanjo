'use client'

import { Fragment, useEffect, useState } from 'react'

export type HomeLocale =
  | 'en'
  | 'th'
  | 'fr'
  | 'ja'
  | 'zh'
  | 'ko'
  | 'es'
  | 'de'
  | 'it'
  | 'pt'

export type HomeCopyKey = 'hero-description' | 'game-body'

type CopyTable = Record<Exclude<HomeLocale, 'en'>, Record<HomeCopyKey, string>>

const COPY: CopyTable = {
  th: {
    'hero-description': `THE KANJO นำวัฒนธรรม JDM ที่แท้จริงและซิมูเลเตอร์การขับขี่ที่สมจริงมารวมไว้ในโลกเดียวกัน

ติดตามรถแต่งจริง รถจริง และวัฒนธรรมบนท้องถนนรอบตัวพวกมัน ตั้งแต่ Civic EG6 ไปจนถึงโลก JDM ที่กว้างขึ้น

จากนั้นนั่งหลังพวงมาลัยและสัมผัสโลกนั้นด้วยตัวคุณเองบน Osaka Loop

รถแต่งจริงคือสิ่งที่หล่อหลอมโปรเจกต์นี้ ซิมูเลเตอร์ทำให้คุณเข้าไปเป็นส่วนหนึ่งของมัน`,
    'game-body': `The Kanjo นำวัฒนธรรมการแต่งรถ JDM จริงเข้าสู่ซิมูเลเตอร์

สร้างรถในแบบที่คุณต้องการ ทุกชิ้นส่วนเปลี่ยนความรู้สึก การตอบสนอง และสมรรถนะของรถ จากนั้นนำมันไปทดสอบบน Osaka Loop ที่สร้างขึ้นใหม่ ด้วยฟิสิกส์รถจริง การจราจร และคู่แข่ง เรียนรู้รถ ปรับเซ็ตอัป สร้างชื่อเสียง และพัฒนารถของคุณให้ไกลยิ่งขึ้น

สร้างรถในฝันของคุณ สร้างตำนาน Kanjo ของคุณ`,
  },
  fr: {
    'hero-description': `THE KANJO réunit la véritable culture JDM et un simulateur de conduite réaliste dans un seul univers.

Suivez de vraies préparations, de vraies voitures et la culture street qui les entoure, des Civic EG6 à la scène JDM au sens large.

Puis prenez le volant et vivez vous-même cet univers sur l’Osaka Loop.

Les vraies préparations façonnent le projet. Le simulateur vous permet d’en faire partie.`,
    'game-body': `The Kanjo fait entrer la véritable culture des préparations JDM dans le simulateur.

Créez la voiture que vous voulez. Chaque pièce change ses sensations, ses réactions et ses performances. Puis testez-la sur un Osaka Loop recréé, avec une physique automobile réaliste, du trafic et des rivaux. Apprenez à connaître la voiture, affinez le réglage, gagnez en réputation et continuez à faire évoluer votre préparation.

Construisez la voiture de vos rêves. Construisez votre légende Kanjo.`,
  },
  ja: {
    'hero-description': `THE KANJOは、本物のJDMカルチャーとリアルなドライビングシミュレーターをひとつの世界に融合します。

Civic EG6から、より広いJDMシーンまで。実在するビルド、実車、そしてそれらを取り巻くストリートカルチャーを追いかけます。

そして自らステアリングを握り、大阪環状線でその世界を体験してください。

リアルなビルドがプロジェクトを形作り、シミュレーターがあなたをその一部にします。`,
    'game-body': `The Kanjoは、本物のJDMビルドカルチャーをシミュレーターの中に持ち込みます。

自分が欲しいクルマを作る。すべてのパーツが、フィーリング、レスポンス、パフォーマンスを変えます。そして、実車ベースの車両物理、交通、ライバルが存在する再現された大阪環状線で、そのクルマを試してください。クルマを理解し、セットアップを詰め、レピュテーションを獲得し、さらにビルドを進化させていきます。

夢のクルマを作る。自分だけのKanjo Legendを築く。`,
  },
  zh: {
    'hero-description': `THE KANJO 将真实的 JDM 文化与拟真的驾驶模拟器带入同一个世界。

从 Civic EG6 到更广泛的 JDM 场景，关注真实改装、真实车辆，以及围绕它们形成的街头文化。

然后坐进驾驶席，在大阪环线上亲自进入这个世界。

真实改装塑造了这个项目，而模拟器让你成为其中的一部分。`,
    'game-body': `The Kanjo 将真实的 JDM 改装文化带进模拟器。

打造你想要的车。每一个零件都会改变它的驾驶感受、响应和性能。然后把它带到重现的大阪环线上，在真实车辆物理、交通和对手中检验它。熟悉车辆、完善设定、赢得声望，并不断推进你的改装。

打造你的梦想之车。打造属于你的 Kanjo Legend。`,
  },
  ko: {
    'hero-description': `THE KANJO는 진짜 JDM 문화와 사실적인 드라이빙 시뮬레이터를 하나의 세계로 연결합니다.

Civic EG6부터 더 넓은 JDM 씬까지, 실제 빌드와 실제 자동차, 그리고 그 주변의 스트리트 문화를 따라갑니다.

그리고 직접 운전석에 앉아 오사카 루프에서 그 세계를 경험하세요.

실제 빌드가 프로젝트를 만들어 갑니다. 시뮬레이터는 당신을 그 세계의 일부로 만듭니다.`,
    'game-body': `The Kanjo는 진짜 JDM 빌드 문화를 시뮬레이터 안으로 가져옵니다.

원하는 차를 만드세요. 모든 파츠는 차의 감각, 반응, 성능을 바꿉니다. 그런 다음 실제 차량 물리, 교통, 라이벌이 있는 재현된 오사카 루프에서 시험해 보세요. 차를 익히고, 셋업을 다듬고, 명성을 쌓으며 빌드를 계속 발전시키세요.

꿈의 차를 만드세요. 당신만의 Kanjo Legend를 만드세요.`,
  },
  es: {
    'hero-description': `THE KANJO reúne la auténtica cultura JDM y un simulador de conducción realista en un mismo mundo.

Sigue preparaciones reales, coches reales y la cultura callejera que los rodea, desde los Civic EG6 hasta la escena JDM en toda su amplitud.

Después ponte al volante y vive ese mundo por ti mismo en el Osaka Loop.

Las preparaciones reales dan forma al proyecto. El simulador te permite formar parte de él.`,
    'game-body': `The Kanjo lleva la auténtica cultura de las preparaciones JDM al simulador.

Crea el coche que quieras. Cada pieza cambia cómo se siente, responde y rinde. Después ponlo a prueba en un Osaka Loop recreado, con física de vehículos realista, tráfico y rivales. Aprende el coche, afina la puesta a punto, gana reputación y sigue llevando tu preparación más lejos.

Crea el coche de tus sueños. Crea tu propia Kanjo Legend.`,
  },
  de: {
    'hero-description': `THE KANJO verbindet echte JDM-Kultur und einen realistischen Fahrsimulator in einer Welt.

Begleite echte Builds, echte Autos und die Street-Culture rund um sie – vom Civic EG6 bis zur gesamten JDM-Szene.

Dann setz dich selbst ans Steuer und erlebe diese Welt auf dem Osaka Loop.

Die realen Builds prägen das Projekt. Der Simulator lässt dich Teil davon werden.`,
    'game-body': `The Kanjo bringt echte JDM-Build-Kultur in den Simulator.

Baue das Auto, das du willst. Jedes Teil verändert, wie es sich fährt, reagiert und performt. Teste es anschließend auf einem nachgebildeten Osaka Loop mit realistischer Fahrzeugphysik, Verkehr und Rivalen. Lerne das Auto kennen, verfeinere das Setup, verdiene Reputation und entwickle deinen Build immer weiter.

Baue dein Traumauto. Baue deine Kanjo Legend.`,
  },
  it: {
    'hero-description': `THE KANJO unisce la vera cultura JDM e un simulatore di guida realistico in un unico mondo.

Segui build reali, auto reali e la cultura street che le circonda, dalle Civic EG6 alla scena JDM più ampia.

Poi mettiti al volante e vivi in prima persona quel mondo sull’Osaka Loop.

Le build reali danno forma al progetto. Il simulatore ti permette di farne parte.`,
    'game-body': `The Kanjo porta nel simulatore la vera cultura delle build JDM.

Crea l’auto che vuoi. Ogni componente cambia il modo in cui si sente, risponde e si comporta. Poi mettila alla prova su un Osaka Loop ricreato, con fisica realistica dei veicoli, traffico e rivali. Impara a conoscere l’auto, perfeziona il setup, guadagna reputazione e continua a far evolvere la tua build.

Crea l’auto dei tuoi sogni. Crea la tua Kanjo Legend.`,
  },
  pt: {
    'hero-description': `THE KANJO reúne a verdadeira cultura JDM e um simulador de condução realista em um só mundo.

Acompanhe projetos reais, carros reais e a cultura de rua ao redor deles, dos Civic EG6 à cena JDM em toda a sua amplitude.

Depois, assuma o volante e viva esse mundo por conta própria no Osaka Loop.

Os projetos reais moldam este projeto. O simulador permite que você faça parte dele.`,
    'game-body': `The Kanjo leva a verdadeira cultura de preparação JDM para o simulador.

Monte o carro que você quiser. Cada peça muda a forma como ele se comporta, responde e entrega desempenho. Depois, teste-o em um Osaka Loop recriado, com física veicular realista, tráfego e rivais. Aprenda o carro, refine o acerto, ganhe reputação e continue levando o projeto mais longe.

Monte o carro dos seus sonhos. Construa sua Kanjo Legend.`,
  },
}

const SUPPORTED = new Set<HomeLocale>([
  'en',
  'th',
  'fr',
  'ja',
  'zh',
  'ko',
  'es',
  'de',
  'it',
  'pt',
])

function browserLocale(): HomeLocale {
  if (typeof navigator === 'undefined') return 'en'

  const preferred = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]

  for (const language of preferred) {
    const base = language.toLowerCase().split('-')[0] as HomeLocale
    if (SUPPORTED.has(base)) return base
  }

  return 'en'
}

function localeHtmlLang(locale: HomeLocale): string {
  return locale === 'zh' ? 'zh-Hans' : locale
}

export function useHomeLocale(): HomeLocale {
  const [locale, setLocale] = useState<HomeLocale>('en')

  useEffect(() => {
    const detected = browserLocale()
    setLocale(detected)
    document.documentElement.lang = localeHtmlLang(detected)
  }, [])

  return locale
}

function localizedText(
  keyName: HomeCopyKey,
  english: string,
  locale: HomeLocale,
): string {
  if (locale === 'en') return english
  return COPY[locale][keyName]
}

export function LocalizedInlineCopy({
  copyKey,
  english,
}: {
  copyKey: HomeCopyKey
  english: string
}) {
  const locale = useHomeLocale()
  return <>{localizedText(copyKey, english, locale)}</>
}

export function LocalizedParagraphCopy({
  copyKey,
  english,
}: {
  copyKey: HomeCopyKey
  english: string
}) {
  const locale = useHomeLocale()
  const value = localizedText(copyKey, english, locale)
  const paragraphs = value.split(/\n\s*\n/).filter(Boolean)

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <Fragment key={index}>
          <p>{paragraph}</p>
        </Fragment>
      ))}
    </>
  )
}
