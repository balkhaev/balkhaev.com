export interface Story {
  source: string;
  text: string;
  title: string;
  url: string;
}

export interface Issue {
  date: string;
  post: number | null;
  stories: Story[];
}

// The edition selected for the site's launch was previewed, not posted to Telegram.
export const FIRST_ISSUE: Issue = {
  date: "2026-11-04",
  post: null,
  stories: [
    {
      source: "arXiv",
      text: "Опубликованы веса Dory1.0-4B: модель может повторять внутренние вычисления перед ответом. По словам авторов, дополнительные проходы повышают точность, особенно в программировании и работе с длинными текстами.",
      title: "Dory1.0-4B: открытая модель с регулируемыми вычислениями",
      url: "https://arxiv.org/abs/2611.03998",
    },
    {
      source: "arXiv",
      text: "Опубликованы веса и код PrimeSim — симулятора, который создаёт согласованные виды с нескольких камер по командам действий. Разработчики могут использовать его для отработки управления роботами.",
      title: "PrimeSim: открытая модель для симуляции действий роботов",
      url: "https://arxiv.org/abs/2611.04870",
    },
    {
      source: "Hugging Face",
      text: "Опубликована ускоренная версия Qwen-Image-2.1 для создания и редактирования картинок по одному или нескольким образцам. Есть веса и пример запуска; лицензия ограничивает коммерческое использование.",
      title: "Вышли веса Qwen-Image-2.1-Lightning-v2-RL",
      url: "https://huggingface.co/lightx2v/Qwen-Image-2.1-Lightning-v2-RL",
    },
    {
      source: "Hugging Face",
      text: "Вышла Idol Turbo — ускоренная версия Idol для превращения изображения объекта в 3D-представление, совместимая с ComfyUI. По словам авторов, она требует меньше вычислений, но иногда уступает исходной модели по деталям и цвету.",
      title: "Idol Turbo ускоряет создание 3D-объектов по картинке",
      url: "https://huggingface.co/akhaliq/idol-turbo",
    },
  ],
};
