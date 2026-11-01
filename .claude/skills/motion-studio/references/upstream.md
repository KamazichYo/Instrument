# Сторонние паки: что есть в мире и когда их звать

Обзор от 1 ноября 2026: GitHub и западные обзоры (skills.sh, autoae.online, tella.com, composio). Звёзды взяты на ту же дату. Motion Studio закрывает 80% задач сам и без зависимостей. Паки ниже ставь, когда нужен их конёк:
```bash
bash $S/scripts/install-upstream.sh --list
bash $S/scripts/install-upstream.sh recommended        # hyperframes remotion bart motionmaxxing lottie
bash $S/scripts/install-upstream.sh bart --global      # в ~/.claude/skills для всех проектов
```
Скиллы встают в `.claude/skills/up-<пак>-<скилл>/` со своими именами. Начинают работать со следующей сессии Claude Code.

## Топ по популярности

| Пак | ★ | Лицензия | Конёк | Звать когда |
|---|---|---|---|---|
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | 77k | Apache-2.0 | HTML+GSAP → видео, CLI, ~450 готовых блоков (переходы, титры, графики, 3D), «reverse-any-video», Figma, облачный рендер | нужен готовый блок (CRT, глитч, карта); повторить чужой ролик кадр в кадр; импорт из Figma |
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | 74k | **AGPL-3.0** | агентная видеостудия: 12 пайплайнов, 100+ инструментов, ИИ-генерация футажа | полный продакшн с генеративным видео/аватарами (AGPL: осторожно в коммерции) |
| [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | 16k | Apache-2.0 | кинематографичные продуктовые промо на Remotion, 124 карточки шотов | дорогое промо в стиле Apple на React |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | 6k | Remotion License (бесплатно для частных лиц и команд ≤3, иначе платно) | официальные скиллы Remotion: создание, субтитры, карты, рендер | проект уже на Remotion / нужен React-стек / серверный рендер Lambda |
| [Vincentwei1021/anything2explainer](https://github.com/Vincentwei1021/anything2explainer) | 3k | — | тема → эксплейнер с голосом | быстрый образовательный ролик «под ключ» |
| [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) | 2.7k | MIT | принципы моушн-дизайна (тайминг, кривые, хореография, Дисней) | дополнительная теория для UI-анимаций и Lottie |
| [nateherkai/herk-edit-kit](https://github.com/nateherkai/herk-edit-kit) | 2.5k | — | монтаж Reels/Shorts: транскрипт, нарезка, 15 скиллов | монтаж живого видео, а не графика |
| [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles) | 1.5k | MIT | моушн для интерфейсов + аудит | анимации в продукте/на сайте |
| [Tejashmakwana/motionmaxxing](https://github.com/Tejashmakwana/motionmaxxing) | 1.2k | Apache-2.0 | режиссура против «нейрослопа»: замеры 53 профессиональных роликов, гейты, бренд по URL, ElevenLabs | премиум лаунч-фильм для бренда, строгая самопроверка |
| [iart-ai/motion-skills](https://github.com/iart-ai/motion-skills) | 1.1k | MIT | 50 узких скиллов: кинетика, дата-виз, переходы | нужен конкретный эффект |
| [Barty-Bart/motion-graphics](https://github.com/Barty-Bart/motion-graphics) | 1k | MIT | **пак из видео про Opus 5.5**: motion-broll (B-roll по словам говорящей головы), 3 эксплейнера, вырезка объекта SAM2, звуковой проход (CC0-библиотека) | перебивки к говорящей голове в стиле «одна морфящаяся фигура + курсор»; вырезать человека из фона |
| [charlie947/motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) | 0.5k | MIT | 15 скиллов: лаунч, Vox-эксплейнер, 3D-титры, milestone, reel-export, brand-intake | Vox-стиль, 3D-титры на three.js |
| [howseen-ai/claude-motion-design](https://github.com/howseen-ai/claude-motion-design) | 0.7k | MIT | HTML+Playwright+ffmpeg, ремейк по референсу | «сделай как в этом видео» |
| [latent-spaces/brag](https://github.com/latent-spaces/brag) | 20k | MIT | одна команда: лаунч-видео про проект из кода | ролик про собственный репозиторий |
| [zhuyansen/awesome-claude-video-skills](https://github.com/zhuyansen/awesome-claude-video-skills) | 1.4k | — | каталог 180 репозиториев видео-скиллов | искать что-то редкое |

### 3D
| Пак | ★ | Лицензия | Конёк |
|---|---|---|---|
| [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) | 33k | MIT | Claude управляет Blender: моделирование, материалы, рендер Cycles |
| [arjun988/blender-skills](https://github.com/arjun988/blender-skills) | 1.6k | MIT | 94 скилла для Blender-пайплайна через MCP (`install-upstream.sh blender`) |
| [viettranx/3dviz-pro-max](https://github.com/viettranx/3dviz-pro-max) | 1k | MIT | режиссура 3D-сцен: разбор объекта, свет, камера (`3dviz`) |
| [scottstts/Threejs-Awesome-Graphics-Agent-Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills) | 1k | MIT | процедурные материалы, вода, облака, атмосфера, планеты (`threejs`) |
| [majidmanzarpour/threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills) | 2.7k | MIT | AAA-графика three.js для игр — приёмы света и пост-обработки те же |
| [iart-ai/webgl-animation-skills](https://github.com/iart-ai/webgl-animation-skills) | 50 | MIT | three.js-анимация, GLSL, частицы |
| Meshy (`meshy-3d-agent` в аккаунте) | — | — | генерация 3D-моделей из текста/картинки, риг, анимация → GLB |

Важно: почти все three.js-скиллы писались для интерактива в реальном времени (`clock.getDelta`). Для видео бери их приёмы, а анимацию делай функцией t (см. `3d.md`).

Интеграции с монтажками: [after-effects-mcp](https://github.com/Engine-Room-Games/after-effects-mcp) (MIT) — Claude управляет After Effects; DaVinci Resolve — `appariciojunior/video-editor-skills`.

## Русскоязычные
- В аккаунте пользователя может быть включён скилл **vizavi-motion** (anthropic-skills) — русскоязычный моушн-пак. Если он есть, используй его наравне с этим.

## Чем Motion Studio отличается
- Всё офлайн: свой движок рендера, свои шрифты с кириллицей (Inter, Unbounded, Manrope, JetBrains Mono — OFL), синтез звуков и музыки — никаких API-ключей и лицензий.
- Русские шаблоны и тексты, безопасные зоны Reels из коробки, один файл → любой формат.
- Самопроверка цифрами (`lint.mjs` до рендера, `qa.mjs` после).
- Стыковка с Instrument: .srt из «Субтитров» → `words.mjs`, голос из «Звука» → `mix.mjs`.

## Когда что выбрать
- Быстрый ролик в соцсети, плашки, субтитры, графики, стинги → **Motion Studio**.
- Нужен конкретный готовый эффект → `hyperframes` (registry) или `iart`.
- Проект на React / рендер на сервере → `remotion`.
- Премиум бренд-фильм с жёсткой критикой → `motionmaxxing` (его законы уже в `principles.md`).
- Перебивки к говорящей голове с морфингом одной фигуры → `bart` (motion-broll), либо наш `playbooks.md#broll`.
- Генеративное видео / аватары → OpenMontage или HyperFrames media-use (нужны ключи HeyGen и т.п.).
