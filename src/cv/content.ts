export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];

export interface Job {
  company: string;
  period: string;
  place?: string;
  points: string[];
  role: string;
  /** Product domains shown as links instead of a place. */
  sites?: string[];
}

export interface Project {
  name: string;
  text: string;
  url?: string;
}

export interface Resume {
  description: string;
  details: string;
  /** Short entries closing the web development section. */
  earlier: Job[];
  education: string;
  headline: string;
  /** Machine learning work, newest first. */
  jobs: Job[];
  labels: {
    details: string;
    education: string;
    experience: string;
    format: string;
    languages: string;
    skills: string;
    switcher: string;
    web: string;
  };
  languages: string;
  location: string;
  name: string;
  pdf: string;
  projectGroups: { label: string; projects: Project[] }[];
  skills: { group: string; items: string }[];
  summary: string;
  title: string;
  /** Web development before the move to machine learning. */
  web: Job[];
}

const HEADLINE = "ML Engineer / Generative AI Engineer / Product Developer";
const AIGF_SITES = ["luv.club", "adorely.co", "sinly.io"];

export const RESUMES: Record<Lang, Resume> = {
  en: {
    description:
      "Mikhail Balkhaev, ML engineer working on generative AI: image and video diffusion, speech, LLM agents, vector search and GPU infrastructure.",
    details:
      "Full-time, part-time or project work; remote, hybrid or on-site; open to business travel and relocation within Russia.",
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
          "WordPress and ModX: modules for a city news portal, SQL optimisation.",
        ],
        role: "Web Developer",
      },
      {
        company: "RedBox",
        period: "2011 – 2012",
        place: "Buryatia",
        points: ["Joomla and WordPress templates, jQuery."],
        role: "HTML Developer",
      },
    ],
    education: "Secondary education",
    headline: HEADLINE,
    jobs: [
      {
        company: "AIGF",
        period: "Mar 2026 – present",
        points: [
          "AI companion platforms (18+) with image, video and 3D generation, chat and voice: a multi-tenant Hono backend, Redis/BullMQ workers and RunPod GPU jobs with idempotent submission.",
          "Identity-consistent photos with Qwen Image 2.1: an edit-consistency LoRA, up to four reference images and an automatic redraw when the face drifts.",
          "Video: text- and image-to-video with two-pass sampling and RIFE interpolation to 48 fps; face and full-character swap with MiniMax H3 and swap LoRAs.",
          "3D stage to video: the reference render conditions only the first 5 of 20 sampling steps, which keeps the camera and composition while the model produces natural motion.",
          "Companion memory: LLM fact extraction with corrections, hybrid retrieval over OpenAI embeddings in pgvector, lexical reranking and LLM relevance scoring.",
          "Age-safety checks for generated media: face detection, a ViT age classifier and a logistic probe on CLIP ViT-B/16 embeddings trained on 9,574 labelled person crops. On held-out data, correct refusals rose from 283 to 350 of 400 and false refusals fell from 26 to 3 of 302.",
          "Tool-using Grok agents: a studio director that sets up shoots and reviews results, and a 3D scene editor with validated, revision-checked edits; REST and MCP API with OAuth 2.1.",
          "Voice: self-hosted Kokoro-82M TTS on CPU (ONNX, 54 voices) and Whisper recognition.",
        ],
        role: "Generative AI Engineer",
        sites: AIGF_SITES,
      },
      {
        company: "Funcorp",
        period: "Nov 2024 – Mar 2026",
        place: "Cyprus",
        points: [
          "Started on the main product, then built new AI products from scratch.",
          "Diffusion pipelines for images and video (Wan 2.2, LTX, SD, SDXL) in ComfyUI and DiffSynth-Studio; dataset collection and LoRA training.",
          "Text-to-speech: voice design and fine-tuning the model for natural-sounding speech.",
          "LLM features with Qwen3.5-9B, ChatGPT and Grok; RAG on Qdrant.",
          "Data and backend: Kafka, ClickHouse, PostgreSQL, Redis, Next.js, Hono, FFmpeg.",
        ],
        role: "Senior Product Developer",
      },
    ],
    labels: {
      details: "Details",
      education: "Education",
      experience: "Experience",
      format: "Work",
      languages: "Languages",
      skills: "Skills",
      switcher: "Language",
      web: "Web development",
    },
    languages: "Russian (native), English (upper intermediate, B2)",
    location: "Moscow, Russia",
    name: "Mikhail Balkhaev",
    pdf: "balkhaev-cv-en.pdf",
    projectGroups: [
      {
        label: "AI and media",
        projects: [
          {
            name: "Studio",
            text: "AI film production: a Claude producer agent turns an idea into a script and staged shots, renders reference passes in Blender over MCP and generates the shots with H3. A take is accepted only after frame decoding, a vision-model review and a speech-transcription check.",
            url: "https://film.balkhaev.com/",
          },
          {
            name: "MediaPipes",
            text: "Image, video and speech generation on ComfyUI and vLLM: Qwen Image 2.1 INT8 with up to ten references, tiled upscaling to 8 MP, Higgs TTS 3 (4B). INT8 attention for H3 cut sampling from 13.0 to 6.8 s/step (a swap job from 129 to 80 s) and shipped after identity, lip-sync and LPIPS metrics and a blind review.",
            url: "https://mediapipes.balkhaev.com/",
          },
          {
            name: "Persons",
            text: "Character identity service: seven reference views and a character sheet per character, CPU face checks with YuNet and 512-d AuraFace embeddings, storyboard stills with up to four characters, and a PostgreSQL job queue with SKIP LOCKED and per-person fairness.",
          },
          {
            name: "Modeler",
            text: "Characters and previz in Blender: image-to-3D with TRELLIS.2 and Pixal3D to textured GLB, text-to-motion on a 63-bone rig with foot-contact quality gates, Qwen-guided facial reconstruction.",
            url: "https://modeler.balkhaev.com/",
          },
          {
            name: "Montage",
            text: "Video understanding: Qwen3-VL-4B frame descriptions, word-aligned WhisperX transcripts and PySceneDetect cuts in one timeline, with models loaded in turn to fit one GPU; video-to-video recasting with H3.",
          },
          {
            name: "Inference",
            text: "GPU scheduler for a home RTX 5080 shared by ComfyUI, local LLMs and Blender: admission by measured RAM and VRAM peaks, GPU sharing only after three comparable solo runs, warm-model residency and budgets that grow after out-of-memory errors.",
          },
          {
            name: "Local LLM",
            text: "Qwen3.8-Flash-Next (125B GGUF) on one RTX 5080 through Strata, with experts spread across VRAM, RAM and SSD, a 262k context and about 100 tokens/s; an OpenAI- and Anthropic-compatible gateway with multi-account routing.",
          },
        ],
      },
      {
        label: "Client projects",
        projects: [
          {
            name: "ZemStroy CRM",
            text: "Sales CRM for a land development company, designed and built from scratch: leads from amoCRM, Avito and CIAN in one pipeline on Redis/BullMQ queues; every call transcribed with Whisper and scored by an LLM; a first-response bot with versioned prompts; semantic search on embeddings in Qdrant; Telegram alerts on new leads and SLA breaches.",
          },
          {
            name: "Altai Land",
            text: "Sales website for a land development project in Altai with an interactive 3D valley on Three.js: scene packages streamed to mobile devices (first load cut from 7.2 to 3.7 MB), a chunked forest of 79,125 trees (5.9M to 1.2M triangles), a 568-plot masterplan shared by the 2D and 3D views, and 31 indexable pages for search traffic.",
            url: "https://алтайземля.рф/",
          },
        ],
      },
      {
        label: "Data and search products",
        projects: [
          {
            name: "ggpick.club",
            text: "Multilingual game discovery service in Russian, English and Chinese: Steam and community data in PostgreSQL, hybrid search on multilingual-e5 embeddings in Qdrant with cross-encoder reranking and graceful degradation when models are unavailable, transliteration and keyboard-layout correction for queries. 200+ unique visitors a day.",
            url: "https://ggpick.club/",
          },
          {
            name: "Polywin",
            text: "Research platform for Polymarket prediction markets: typed market-data clients with WebSocket order-book reconciliation, an opportunity scanner that accounts for book depth and fees, semantic retrieval on embeddings in Qdrant and LLM analysis of news with validated quotes, forecasts scored by Brier score and calibration. A strategy emits signals only after 30+ resolved markets with a statistically significant edge.",
          },
        ],
      },
    ],
    skills: [
      {
        group: "Generative models",
        items:
          "Qwen Image, H3, Wan 2.2, LTX, SD, SDXL, TRELLIS.2, Kokoro, Higgs TTS, Whisper, Qwen3-VL",
      },
      {
        group: "ML engineering",
        items:
          "LoRA training, datasets, evaluation (identity similarity, LPIPS, lip-sync, held-out sets), CLIP probes, embeddings and RAG, INT8 and GGUF inference",
      },
      {
        group: "Serving",
        items:
          "ComfyUI, vLLM, ONNX Runtime, RunPod, GPU scheduling, Redis/BullMQ",
      },
      {
        group: "Search and RAG",
        items:
          "Embeddings (OpenAI, multilingual-e5, CLIP, AuraFace), Qdrant, pgvector, hybrid search, cross-encoder reranking, RAG, LLM memory",
      },
      {
        group: "LLM and agents",
        items: "Tool use, MCP, Claude, GPT, Grok, Qwen",
      },
      {
        group: "Backend and data",
        items:
          "Python, TypeScript, Node.js, Bun, Hono, FastAPI, PostgreSQL, ClickHouse, Kafka, Redis, Qdrant, SQLite, Docker",
      },
      {
        group: "Frontend and 3D",
        items: "React, Next.js, Three.js, WebGL, Blender, Playwright",
      },
    ],
    summary:
      "ML engineer working on generative AI: image and video diffusion, speech, LLM agents, search and the GPU infrastructure behind them. I take products from the model pipeline and quality evaluation to the backend, the interface and production. Embeddings and vector search (Qdrant, pgvector) with hybrid retrieval and reranking run through most of my projects: companion memory at AIGF, RAG at Funcorp, game search on ggpick.club, the Polywin research platform and a sales CRM. Before that, 13 years of web development, including VK (Delivery Club) and Yandex (Yandex Eats).",
    title: "Mikhail Balkhaev — CV",
    web: [
      {
        company: "Yandex",
        period: "Oct 2022 – Aug 2024",
        place: "Moscow",
        points: [
          "Moved from VK with the Delivery Club team to the Yandex Eats advertising unit: analytics and fast testing of ad hypotheses.",
          "Main Yandex Eats and Yandex Vendor webviews; micro-frontend architecture.",
          "An ad runner game whose first partner was Haval at its Russian launch; most of the banner ads, analytics debugging and new metrics.",
        ],
        role: "Frontend Developer",
      },
      {
        company: "VK",
        period: "Jun 2020 – Oct 2022",
        place: "Delivery Club",
        points: [
          "Maintained delivery-club.ru, effectively full-stack: admin panels for partners and lawyers, ad formats, internal UI and API libraries.",
          "After an incident, built a document tool for the legal team with versioning and audit logs.",
        ],
        role: "Lead Developer",
      },
      {
        company: "Data-screen",
        period: "Jun 2019 – Mar 2020",
        place: "Moscow",
        points: [
          "A sports streaming service built from high-level ideas with full technical ownership (Node.js, React, PostgreSQL, Redis, Docker); COVID put it on hold.",
        ],
        role: "Full-stack Developer",
      },
      {
        company: "Smart Solution",
        period: "Nov 2015 – Dec 2018",
        place: "Moscow",
        points: [
          "Frontend for about ten high-traffic sites in the Alexa top 50: legacy rewrites, optimisation and builds; ad integrations; trained developers and reviewed code.",
        ],
        role: "Senior Frontend Developer",
      },
    ],
  },
  ru: {
    description:
      "Михаил Бальхаев, ML-инженер в генеративном AI: диффузия для фото и видео, синтез речи, LLM-агенты, векторный поиск и GPU-инфраструктура.",
    details:
      "Полная или частичная занятость, проекты; удалённо, гибрид или офис; готов к переезду по России.",
    earlier: [
      {
        company: "Oversun",
        period: "2014 – 2015",
        points: [
          "Сайты на WordPress с нуля, свои модули, руководство младшим верстальщиком.",
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
        points: ["Шаблоны для Joomla и WordPress, jQuery."],
        role: "HTML-верстальщик",
      },
    ],
    education: "Среднее",
    headline: HEADLINE,
    jobs: [
      {
        company: "AIGF",
        period: "Март 2026 – сейчас",
        points: [
          "Платформы AI-компаньонов (18+) с генерацией фото, видео и 3D, чатом и голосом: мультитенантный бэкенд на Hono, воркеры Redis/BullMQ, GPU-задачи на RunPod.",
          "Фото с сохранением внешности на Qwen Image 2.1: LoRA для согласованных правок, до четырёх референсов и автоматическая перерисовка, если лицо «уплыло».",
          "Видео: text-to-video и image-to-video с двухпроходным сэмплированием и интерполяцией RIFE до 48 fps; замена лица и всего персонажа на MiniMax H3 со swap-LoRA.",
          "3D-сцена в видео: референсный рендер задаёт только первые 5 из 20 шагов сэмплирования, так что камера и композиция сохраняются, а движение остаётся естественным.",
          "Память компаньонов: извлечение фактов LLM с исправлениями, гибридный поиск по эмбеддингам OpenAI в pgvector, лексическое переранжирование и оценка релевантности LLM.",
          "Проверка возраста на сгенерированных медиа: детекция лиц, ViT-классификатор возраста и логистический пробник на эмбеддингах CLIP, обученный на 9 574 примерах. На отложенных данных верные отказы выросли с 283 до 350 из 400, ложные упали с 26 до 3 из 302.",
          "Агенты на Grok с инструментами: режиссёр студии настраивает съёмки и проверяет результат, 3D-редактор правит сцены с валидацией и контролем ревизий; REST и MCP API с OAuth 2.1.",
          "Голос: свой TTS на CPU (Kokoro-82M в ONNX, 54 голоса) и распознавание на Whisper.",
        ],
        role: "Generative AI Engineer",
        sites: AIGF_SITES,
      },
      {
        company: "Funcorp",
        period: "Ноябрь 2024 – март 2026",
        place: "Кипр",
        points: [
          "Начинал с поддержки основного продукта, потом делал новые AI-продукты с нуля.",
          "Диффузионные пайплайны для фото и видео (Wan 2.2, LTX, SD, SDXL) в ComfyUI и DiffSynth-Studio; сбор датасетов и обучение LoRA.",
          "Синтез речи: дизайн голосов и дообучение модели для естественного звучания.",
          "LLM-функции на Qwen3.5-9B, ChatGPT и Grok; RAG на Qdrant.",
          "Данные и бэкенд: Kafka, ClickHouse, PostgreSQL, Redis, Next.js, Hono, FFmpeg.",
        ],
        role: "Senior Product Developer",
      },
    ],
    labels: {
      details: "Детали",
      education: "Образование",
      experience: "Опыт",
      format: "Формат",
      languages: "Языки",
      skills: "Навыки",
      switcher: "Язык",
      web: "Веб-разработка",
    },
    languages: "Русский (родной), английский (выше среднего, B2)",
    location: "Москва",
    name: "Михаил Бальхаев",
    pdf: "balkhaev-cv-ru.pdf",
    projectGroups: [
      {
        label: "AI и медиа",
        projects: [
          {
            name: "Studio",
            text: "Производство AI-фильмов: агент-продюсер на Claude превращает идею в сценарий и поставленные кадры, рендерит референсные проходы в Blender через MCP и генерирует кадры на H3. Дубль принимается, только если прошёл декодирование кадров, проверку визуальной моделью и транскрибацию речи.",
            url: "https://film.balkhaev.com/",
          },
          {
            name: "MediaPipes",
            text: "Генерация фото, видео и речи на ComfyUI и vLLM: Qwen Image 2.1 INT8 с десятью референсами, тайловый апскейл до 8 Мп, Higgs TTS 3 (4B). INT8-attention для H3 ускорил сэмплирование с 13,0 до 6,8 с/шаг (задача замены: со 129 до 80 с) и попал в прод после замеров сходства лиц, липсинка, LPIPS и слепого сравнения.",
            url: "https://mediapipes.balkhaev.com/",
          },
          {
            name: "Persons",
            text: "Сервис персонажей: семь референсных ракурсов и лист персонажа, проверка лиц на CPU (YuNet, 512-мерные эмбеддинги AuraFace), раскадровки до четырёх персонажей в кадре, очередь задач на PostgreSQL со SKIP LOCKED и справедливым распределением.",
          },
          {
            name: "Modeler",
            text: "Персонажи и превиз в Blender: image-to-3D (TRELLIS.2, Pixal3D) в GLB с текстурами, text-to-motion на риге из 63 костей с проверкой контакта стоп, реконструкция лица по снимкам Qwen.",
            url: "https://modeler.balkhaev.com/",
          },
          {
            name: "Montage",
            text: "Разбор видео: описания кадров от Qwen3-VL-4B, транскрипт WhisperX с выравниванием слов и склейки PySceneDetect в одном таймлайне, модели загружаются по очереди, чтобы уместиться в одну GPU; перекаст видео на H3.",
          },
          {
            name: "Inference",
            text: "Планировщик GPU для домашней RTX 5080 (ComfyUI, локальные LLM, Blender): допуск по измеренным пикам RAM и VRAM, совместный запуск только после трёх сопоставимых одиночных, прогретые модели и бюджеты, растущие после нехватки памяти.",
          },
          {
            name: "Локальная LLM",
            text: "Qwen3.8-Flash-Next (125B, GGUF) на одной RTX 5080 через Strata: эксперты распределены между VRAM, RAM и SSD, контекст 262k, около 100 токенов/с; шлюз с API OpenAI и Anthropic и маршрутизацией по аккаунтам.",
          },
        ],
      },
      {
        label: "Коммерческие проекты",
        projects: [
          {
            name: "CRM Земстрой",
            text: "CRM отдела продаж компании по продаже земли, спроектирована и сделана с нуля: лиды из amoCRM, Avito и ЦИАН в одной воронке на очередях Redis/BullMQ; каждый звонок транскрибируется Whisper и оценивается LLM; бот первого ответа с версиями промптов; семантический поиск на эмбеддингах в Qdrant; уведомления в Telegram о новых лидах и нарушениях SLA.",
          },
          {
            name: "Алтай — живая земля",
            text: "Продающий сайт посёлка на Алтае с интерактивной 3D-долиной на Three.js: потоковая загрузка сцен на мобильных (первая загрузка с 7,2 до 3,7 МБ), лес из 79 125 деревьев по чанкам (с 5,9 до 1,2 млн треугольников), генплан на 568 участков, общий для 2D и 3D, 31 индексируемая страница под поисковый трафик.",
            url: "https://алтайземля.рф/",
          },
        ],
      },
      {
        label: "Продукты на данных и поиске",
        projects: [
          {
            name: "ggpick.club",
            text: "Поиск игр на русском, английском и китайском: данные Steam и сообществ в PostgreSQL, гибридный поиск на эмбеддингах multilingual-e5 в Qdrant с переранжированием cross-encoder и деградацией без отказа, если модели недоступны, транслитерация и исправление раскладки в запросах. 200+ уникальных посетителей в день.",
            url: "https://ggpick.club/",
          },
          {
            name: "Polywin",
            text: "Исследовательская платформа для рынков предсказаний Polymarket: типизированные клиенты рыночных данных со сверкой стакана по WebSocket, сканер возможностей с учётом глубины стакана и комиссий, семантический поиск на эмбеддингах в Qdrant и разбор новостей LLM с проверкой цитат, оценка прогнозов по Brier score и калибровке. Стратегия выдаёт сигналы только после 30+ закрытых рынков со статистически значимым преимуществом.",
          },
        ],
      },
    ],
    skills: [
      {
        group: "Модели",
        items:
          "Qwen Image, H3, Wan 2.2, LTX, SD, SDXL, TRELLIS.2, Kokoro, Higgs TTS, Whisper, Qwen3-VL",
      },
      {
        group: "ML-инженерия",
        items:
          "Обучение LoRA, датасеты, оценка (сходство лиц, LPIPS, липсинк), CLIP-пробники, эмбеддинги и RAG, INT8 и GGUF",
      },
      {
        group: "Сервинг",
        items:
          "ComfyUI, vLLM, ONNX Runtime, RunPod, планирование GPU, Redis/BullMQ",
      },
      {
        group: "Поиск и RAG",
        items:
          "Эмбеддинги (OpenAI, multilingual-e5, CLIP, AuraFace), Qdrant, pgvector, гибридный поиск, переранжирование cross-encoder, RAG, память для LLM",
      },
      {
        group: "LLM и агенты",
        items: "Tool use, MCP, Claude, GPT, Grok, Qwen",
      },
      {
        group: "Бэкенд и данные",
        items:
          "Python, TypeScript, Node.js, Bun, Hono, FastAPI, PostgreSQL, ClickHouse, Kafka, Redis, Qdrant, SQLite, Docker",
      },
      {
        group: "Фронтенд и 3D",
        items: "React, Next.js, Three.js, WebGL, Blender, Playwright",
      },
    ],
    summary:
      "ML-инженер в генеративном AI: диффузия для фото и видео, синтез речи, LLM-агенты, поиск и GPU-инфраструктура под них. Довожу продукты от пайплайна моделей и оценки качества до бэкенда, интерфейса и продакшена. Эмбеддинги и векторный поиск (Qdrant, pgvector) с гибридным поиском и переранжированием есть в большинстве моих проектов: память компаньонов в AIGF, RAG в Funcorp, поиск игр на ggpick.club, исследовательская платформа Polywin и CRM отдела продаж. До этого 13 лет в веб-разработке, в том числе в VK (Delivery Club) и Яндексе (Яндекс Еда).",
    title: "Михаил Бальхаев — резюме",
    web: [
      {
        company: "Яндекс",
        period: "Октябрь 2022 – август 2024",
        place: "Москва",
        points: [
          "Перешёл из VK вместе с командой Delivery Club в рекламное направление Яндекс Еды: аналитика и быстрая проверка рекламных гипотез.",
          "Основной webview Яндекс Еды и Яндекс Вендора, микрофронтендная архитектура.",
          "Рекламный раннер, первым партнёром которого стал Haval на старте в России; почти вся баннерная реклама, отладка аналитики и новые метрики.",
        ],
        role: "Разработчик интерфейсов",
      },
      {
        company: "VK",
        period: "Июнь 2020 – октябрь 2022",
        place: "Delivery Club",
        points: [
          "Поддерживал delivery-club.ru, фактически как full-stack: админки для партнёров и юристов, рекламные форматы, внутренние UI- и API-библиотеки.",
          "После инцидента сделал для юристов систему документов с версиями и аудит-логами.",
        ],
        role: "Ведущий разработчик",
      },
      {
        company: "Data-screen",
        period: "Июнь 2019 – март 2020",
        place: "Москва",
        points: [
          "Сервис спортивных трансляций по высокоуровневым идеям, все технические решения на мне (Node.js, React, PostgreSQL, Redis, Docker); проект остановил ковид.",
        ],
        role: "Fullstack-разработчик",
      },
      {
        company: "Смарт Солюшн",
        period: "Ноябрь 2015 – декабрь 2018",
        place: "Москва",
        points: [
          "Фронтенд десятка высоконагруженных сайтов из топ-50 Alexa: переписывание legacy, оптимизация и сборка; рекламные интеграции; обучение верстальщиков и код-ревью.",
        ],
        role: "Senior Frontend Developer",
      },
    ],
  },
};
