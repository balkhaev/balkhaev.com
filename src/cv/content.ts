export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];

export interface Job {
  company: string;
  period: string;
  place?: string;
  points: string[];
  role: string;
}

export interface Project {
  name: string;
  text: string;
  url?: string;
}

export interface Resume {
  description: string;
  details: string;
  earlier: Job[];
  education: string;
  headline: string;
  jobs: Job[];
  labels: {
    details: string;
    earlier: string;
    education: string;
    experience: string;
    languages: string;
    projects: string;
    skills: string;
    switcher: string;
  };
  languages: string[];
  location: string;
  name: string;
  pdf: string;
  projects: Project[];
  skills: { group: string; items: string }[];
  summary: string;
  title: string;
}

const HEADLINE = "ML Engineer / Generative AI Engineer / Product Developer";

export const RESUMES: Record<Lang, Resume> = {
  en: {
    description:
      "Mikhail Balkhaev, ML engineer and generative AI engineer. 14 years in software development at VK, Yandex and Funcorp.",
    details:
      "Full-time, part-time or project work. Remote, hybrid or on-site. Open to business travel and relocation within Russia.",
    earlier: [
      {
        company: "Oversun",
        period: "2014 – 2015",
        points: [
          "WordPress sites from scratch with custom modules; led a junior developer on the company website.",
        ],
        role: "Web Developer",
      },
      {
        company: "Ideegroupe",
        period: "2013",
        place: "Sochi",
        points: [
          "WordPress and ModX: modules for a city news portal, SQL optimization.",
        ],
        role: "Web Developer",
      },
      {
        company: "RedBox",
        period: "2011 – 2012",
        place: "Buryatia",
        points: [
          "Joomla and WordPress templates, first responsive layouts, jQuery.",
        ],
        role: "HTML Developer",
      },
    ],
    education: "Secondary education",
    headline: HEADLINE,
    jobs: [
      {
        company: "AIGF",
        period: "Mar 2026 – present",
        place: "luv.club",
        points: [
          "Building luv.club, an 18+ AI companion platform with image and video generation. I work on the whole product: WebSocket API, queue workers, website and admin panel.",
          "Image and video generation on RunPod with Qwen Image 2.1 and H3: characters, outfits, scenes and face swap.",
          "3D-to-video: the reference 3D render guides only the first 5 of 20 sampling steps. The camera and composition stay in place, and the model is free to make the motion natural.",
          "An API and MCP server that let external agents create characters, scenes and shoots.",
        ],
        role: "Generative AI Engineer",
      },
      {
        company: "Funcorp",
        period: "Nov 2024 – Mar 2026",
        place: "Cyprus",
        points: [
          "Started on the main product, then moved to building new AI products from scratch.",
          "Image and video generation with Wan 2.2, LTX, SD and SDXL in ComfyUI and DiffSynth-Studio; dataset preparation and LoRA training.",
          "Text-to-speech: voice design and fine-tuning the model for natural-sounding speech.",
          "LLM features and RAG with Qwen3.5-9B, ChatGPT, Grok and Qdrant.",
          "Next.js, Hono, Kafka, ClickHouse, PostgreSQL, Redis, FFmpeg.",
        ],
        role: "Senior Product Developer",
      },
      {
        company: "Yandex",
        period: "Oct 2022 – Aug 2024",
        place: "Moscow",
        points: [
          "Moved from VK with the Delivery Club team into the Yandex Eats advertising unit. Most of the work was analytics and testing ad hypotheses.",
          "Maintained the main Yandex Eats and Yandex Vendor webviews and improved the micro-frontend architecture.",
          "Built an ad runner game with a courier. The first partner was Haval, which was entering the Russian market at the time: the courier became a car, with billboards along the road.",
          "Implemented most of the banner ads, debugged analytics and proposed new metrics.",
        ],
        role: "Frontend Developer",
      },
      {
        company: "VK",
        period: "Jun 2020 – Oct 2022",
        place: "Delivery Club",
        points: [
          "Maintained delivery-club.ru, effectively as a full-stack developer.",
          "Built admin panels for partners and the legal team, and new ad formats.",
          "Wrote internal libraries: UI components and API helpers.",
          "After an incident, built a document tool for the legal team with versioning and audit logs.",
        ],
        role: "Lead Developer",
      },
      {
        company: "Data-screen",
        period: "Jun 2019 – Mar 2020",
        place: "Moscow",
        points: [
          "Turned high-level ideas into working features and made the technical decisions myself. The main project, a sports streaming service, was put on hold because of COVID.",
          "Node.js, Express, React, Docker, Redis, PostgreSQL, Nginx.",
        ],
        role: "Full-stack Developer",
      },
      {
        company: "Smart Solution",
        period: "Nov 2015 – Dec 2018",
        place: "Moscow",
        points: [
          "Frontend for about ten high-traffic, server-rendered sites in the Alexa top 50: rewrote legacy code, optimized business logic, set up builds.",
          "Responsible for advertising: banners, web push and popunders.",
          "Trained new developers, reviewed code and maintained technical documentation.",
        ],
        role: "Senior Frontend Developer",
      },
    ],
    labels: {
      details: "Availability",
      earlier: "Earlier",
      education: "Education",
      experience: "Experience",
      languages: "Languages",
      projects: "Projects",
      skills: "Skills",
      switcher: "Language",
    },
    languages: ["Russian: native", "English: basic (A1)"],
    location: "Moscow, Russia",
    name: "Mikhail Balkhaev",
    pdf: "balkhaev-cv-en.pdf",
    projects: [
      {
        name: "Inference",
        text: "A job queue for my home RTX 5080 and a laptop RTX 4080 that serve image generation. Each job reserves resources based on the average load of its type, a model stays loaded when the next job needs it, and jobs run in parallel when there is room.",
      },
      {
        name: "Local LLM",
        text: "Qwen3.8-Flash-Next (125B) through Strata at about 100 tokens/s on an RTX 5080 with 64 GB of RAM, driven by DeepSeek Harness with the dsh-purge plugin.",
      },
      {
        name: "balkhaev.com",
        text: "Falling into a Schwarzschild black hole in the browser: WebGL ray tracing in Painlevé–Gullstrand coordinates.",
        url: "https://balkhaev.com/",
      },
      {
        name: "ggpick.club",
        text: "An SEO site about games with 200+ unique visitors a day.",
        url: "https://ggpick.club/",
      },
    ],
    skills: [
      {
        group: "Generative AI",
        items:
          "Wan 2.2, LTX, SD, SDXL, Qwen Image, H3, ComfyUI, DiffSynth-Studio, LoRA training, TTS, FFmpeg",
      },
      {
        group: "LLM",
        items: "RAG, Qdrant, embeddings, local inference, agents, MCP",
      },
      {
        group: "Backend",
        items:
          "Node.js, Bun, Hono, Python, Django, Kafka, ClickHouse, PostgreSQL, Redis, Elasticsearch, MongoDB, GraphQL, REST, Docker",
      },
      {
        group: "Frontend",
        items:
          "TypeScript, React, Next.js, Vue, WebGL, micro-frontends, Webpack, SEO",
      },
    ],
    summary:
      "Software developer with 14 years of experience. I worked on Delivery Club at VK and on Yandex Eats at Yandex, and since 2024 I have been building generative AI products: image and video diffusion pipelines, LoRA training, text-to-speech, RAG and local LLM inference.",
    title: "Mikhail Balkhaev — CV",
  },
  ru: {
    description:
      "Михаил Бальхаев, ML-инженер и инженер по генеративному AI. 14 лет в разработке: VK, Яндекс, Funcorp.",
    details:
      "Полная или частичная занятость, проектная работа. Удалённо, гибрид или офис. Готов к командировкам и переезду по России.",
    earlier: [
      {
        company: "Oversun",
        period: "2014 – 2015",
        points: [
          "Сайты на WordPress с нуля и собственные модули; корпоративный сайт компании с младшим верстальщиком под моим руководством.",
        ],
        role: "Веб-разработчик",
      },
      {
        company: "Ideegroupe",
        period: "2013",
        place: "Сочи",
        points: [
          "WordPress и ModX: модули для городского новостного портала, оптимизация SQL.",
        ],
        role: "Веб-разработчик",
      },
      {
        company: "RedBox",
        period: "2011 – 2012",
        place: "Бурятия",
        points: [
          "Шаблоны для Joomla и WordPress, первые адаптивные вёрстки, jQuery.",
        ],
        role: "HTML-верстальщик",
      },
    ],
    education: "Среднее",
    headline: HEADLINE,
    jobs: [
      {
        company: "AIGF",
        period: "Март 2026 – сейчас",
        place: "luv.club",
        points: [
          "Делаю luv.club, платформу AI-компаньонов (18+) с генерацией фото и видео. Отвечаю за весь продукт: API на WebSocket, воркеры очередей, сайт и админку.",
          "Генерация фото и видео на RunPod с Qwen Image 2.1 и H3: персонажи, образы, сцены, FaceSwap.",
          "3D в видео: референсный 3D-рендер управляет только первыми 5 из 20 шагов сэмплирования. Камера и композиция сохраняются, а движение модель делает естественным.",
          "API и MCP-сервер, через которые внешние агенты создают персонажей, сцены и съёмки.",
        ],
        role: "Generative AI Engineer",
      },
      {
        company: "Funcorp",
        period: "Ноябрь 2024 – март 2026",
        place: "Кипр",
        points: [
          "Начинал с поддержки основного продукта, потом перешёл на новые AI-продукты с нуля.",
          "Генерация изображений и видео: Wan 2.2, LTX, SD и SDXL в ComfyUI и DiffSynth-Studio; подготовка датасетов и обучение LoRA.",
          "Синтез речи: дизайн голосов и дообучение модели, чтобы речь звучала естественно.",
          "LLM и RAG: Qwen3.5-9B, ChatGPT, Grok, Qdrant.",
          "Next.js, Hono, Kafka, ClickHouse, PostgreSQL, Redis, FFmpeg.",
        ],
        role: "Senior Product Developer",
      },
      {
        company: "Яндекс",
        period: "Октябрь 2022 – август 2024",
        place: "Москва",
        points: [
          "Перешёл из VK вместе с командой Delivery Club в рекламное направление Яндекс Еды. Основная работа: аналитика и проверка рекламных гипотез.",
          "Поддерживал основной webview Яндекс Еды и Яндекс Вендора, улучшал микрофронтендную архитектуру.",
          "Сделал рекламный раннер с курьером. Первым партнёром стал Haval, который тогда выходил на российский рынок: курьера заменили машиной, вдоль дороги поставили рекламные щиты.",
          "Реализовал почти всю баннерную рекламу, отлаживал аналитику, предлагал новые метрики.",
        ],
        role: "Разработчик интерфейсов",
      },
      {
        company: "VK",
        period: "Июнь 2020 – октябрь 2022",
        place: "Delivery Club",
        points: [
          "Поддерживал delivery-club.ru, фактически как full-stack.",
          "Делал админки для партнёров и юристов, новые рекламные форматы.",
          "Писал внутренние библиотеки: UI-компоненты и API-хелперы.",
          "После одного из инцидентов сделал админку для юристов с версионированием документов и аудит-логами.",
        ],
        role: "Ведущий разработчик",
      },
      {
        company: "Data-screen",
        period: "Июнь 2019 – март 2020",
        place: "Москва",
        points: [
          "Реализовывал идеи по высокоуровневому описанию, технические решения принимал сам. Основной проект, сервис спортивных трансляций, остановился из-за ковида.",
          "Node.js, Express, React, Docker, Redis, PostgreSQL, Nginx.",
        ],
        role: "Fullstack-разработчик",
      },
      {
        company: "Смарт Солюшн",
        period: "Ноябрь 2015 – декабрь 2018",
        place: "Москва",
        points: [
          "Фронтенд десятка высоконагруженных сайтов из топ-50 Alexa (не SPA, много legacy): переписывание старого кода, оптимизация бизнес-логики, настройка сборки.",
          "Отвечал за рекламу: баннеры, web push, popunder.",
          "Обучал новых верстальщиков, проводил код-ревью, вёл техническую документацию.",
        ],
        role: "Senior Frontend Developer",
      },
    ],
    labels: {
      details: "Формат работы",
      earlier: "Ранее",
      education: "Образование",
      experience: "Опыт",
      languages: "Языки",
      projects: "Проекты",
      skills: "Навыки",
      switcher: "Язык",
    },
    languages: ["Русский: родной", "Английский: начальный (A1)"],
    location: "Москва",
    name: "Михаил Бальхаев",
    pdf: "balkhaev-cv-ru.pdf",
    projects: [
      {
        name: "Inference",
        text: "Очередь задач для домашней RTX 5080 и ноутбука с RTX 4080, которые работают как серверы генерации. Каждое задание резервирует ресурсы по средней нагрузке своего типа, модель не выгружается, если она нужна следующей задаче, а при свободных ресурсах задачи идут параллельно.",
      },
      {
        name: "Локальная LLM",
        text: "Qwen3.8-Flash-Next (125B) через Strata, около 100 токенов/с на RTX 5080 с 64 ГБ RAM. Харнесс DeepSeek Harness с плагином dsh-purge.",
      },
      {
        name: "balkhaev.com",
        text: "Падение в чёрную дыру Шварцшильда в браузере: трассировка лучей на WebGL в координатах Пенлеве–Гульстранда.",
        url: "https://balkhaev.com/",
      },
      {
        name: "ggpick.club",
        text: "SEO-сайт об играх, 200+ уникальных посетителей в день.",
        url: "https://ggpick.club/",
      },
    ],
    skills: [
      {
        group: "Генеративный AI",
        items:
          "Wan 2.2, LTX, SD, SDXL, Qwen Image, H3, ComfyUI, DiffSynth-Studio, обучение LoRA, TTS, FFmpeg",
      },
      {
        group: "LLM",
        items: "RAG, Qdrant, эмбеддинги, локальный инференс, агенты, MCP",
      },
      {
        group: "Бэкенд",
        items:
          "Node.js, Bun, Hono, Python, Django, Kafka, ClickHouse, PostgreSQL, Redis, Elasticsearch, MongoDB, GraphQL, REST, Docker",
      },
      {
        group: "Фронтенд",
        items:
          "TypeScript, React, Next.js, Vue, WebGL, микрофронтенды, Webpack, SEO",
      },
    ],
    summary:
      "Разработчик, 14 лет опыта. Работал над Delivery Club в VK и Яндекс Едой в Яндексе, с 2024 года делаю продукты на генеративном AI: пайплайны генерации изображений и видео, обучение LoRA, синтез речи, RAG и локальный инференс LLM.",
    title: "Михаил Бальхаев — резюме",
  },
};
