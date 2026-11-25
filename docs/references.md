# Trade Shortcuts: референсы (телефон и линза)

## Лучшие референсы: короткий список

Второй проход, 2026-11-24. «открыл» значит, что страницу прочитал сам (WebFetch или браузер); «по сниппету» значит, что видел только результат поиска. Картинки я читаю по alt-тексту и подписям; глазами смотрел один экран (Page Flows), поэтому «что видно» ниже опирается на описания страниц, а не на пиксели. Лучшие в начале, внутри группы по убыванию пользы.

### Стиль

| # | Референс | Что смотреть и что перенять | Статус |
|---|---|---|---|
| 1 | **Выбрано.** [Apple Design Resources](https://developer.apple.com/design/resources/) | UI Kit iOS 27 для Figma и Sketch (списки, sheet, контролы), SF Symbols 7000+, шаблоны Siri and App Shortcuts, Wallet, Apple Pay, Live Activities. Лицензия на странице не названа: загрузки идут по Apple Terms of Use; перед использованием ассетов вне платформ Apple читать условия (ограничение SF Symbols платформами Apple помню по памяти). Kit не скачивал | открыл |
| 2 | [Apple HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography) и [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Шкала iOS 34/41, 28/34, 22/28, 20/25, 17/22, 13/18, 12/16, 11/13; зона нажатия 44×44 pt, минимум 28×28 | открыл (через публичный JSON страницы) |
| 3 | [Apple Health](https://www.apple.com/ios/health/) | Тёмные градиентные карточки, по цвету на категорию (фиолетовый сон, синий слух, зелёный кардио, розовый цикл, оранжевый зрение, красный AFib, бирюзовый ментальное здоровье) с белой иконкой; экраны: круговой sleep score, радиальный график сна с плашкой «7 hr 30 min sleep goal met», кольца Move/Exercise/Stand, сводка списком. Перенять: один цвет на тип правила, одно крупное число или кольцо на экран | открыл |
| 4 | [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) | Стекло только в слое контролов, не в контенте; sheet с ролями Cancel / Done / Back | открыл |
| 5 | [Apple Wallet](https://www.apple.com/wallet/) | Экраны заказов со статусами «delivered» и «on the way»; подтверждение действия двойным нажатием боковой кнопки плюс Face ID или Touch ID. Перенять: подтверждение вынесено на физический жест (у вас это тап по очкам) | открыл |
| 6 | [Linear: how we redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui) | Тема из трёх входов (база, акцент, контраст) вместо 98 переменных, цвета в LCH, Inter Display + Inter | открыл |
| 7 | [Bubble Card](https://github.com/Clooos/Bubble-Card) (MIT, 4752★, 2026-10-31) | README с демо-GIF (GIF не смотрел): минималистичные карточки и pop-up'ы, похожие на bottom sheet, магазин модулей 100+. Перенять: pop-up как способ управлять одной рукой | открыл README |
| 8 | [Mushroom](https://github.com/piitaya/lovelace-mushroom) (Apache-2.0, 5285★, 2026-11-12) | Редактор для всех карточек и всех опций без YAML, icon picker, color picker, 0 зависимостей, светлая и тёмная тема. Перенять: каждая опция доступна визуально | открыл README |
| 9 | [Токены сайта Nothing на shadcn.io](https://www.shadcn.io/design/nothing) | Чёрный `#000`, белый `#fff`, приглушённый `#585a5a`, линия `#e5e7eb`; Ndot только для названий (20–40px), моно 11–14px для подписей; сетка 8, шкала 2/8/12/16/32/40/56; радиусы 6 и 8; без теней, hairline-границы; высота контролов 40. Неофициальная выгрузка стилей сайта, не токены ОС; моушна в ней нет | открыл |
| 10 | [Things 3: features](https://culturedcode.com/things/features/) | Magic Plus: кнопку тянут в нужное место списка; заголовки как структура; плавное раскрытие | открыл |

### Конструктор действий

| # | Референс | Что смотреть и что перенять | Статус |
|---|---|---|---|
| 1 | **Выбрано.** [Apple: «Describe a shortcut» в iOS 27](https://www.apple.com/ios/) и [9to5Mac](https://9to5mac.com/2026/05/18/with-ios-27-shortcuts-is-about-to-become-what-it-was-always-meant-to-be/) | На apple.com виден скриншот диалога запроса к Apple Intelligence; 9to5Mac: приглашение «What do you want your shortcut to do?» и готовый shortcut. Перенять: фраза создаёт черновик в том же визуальном редакторе, дальше правка пилюлями. По сниппетам (не открывал): автоматизации стали «special actions» вверху редактора, один shortcut запускается по любому из нескольких условий; в iOS 13 действия стали настраиваться описательными предложениями | открыл, детали по сниппету |
| 2 | [Home Assistant: automation editor](https://www.home-assistant.io/docs/automation/editor/) | Строки триггер / условие / действие с меню (duplicate, disable, add note, Edit in YAML), перетаскивание за ручку, undo/redo | открыл |
| 3 | [Page Flows: Creating an automation workflow](https://pageflows.com/ios/flows/creating-an-automation-workflow/) | В браузере открылась без входа: три карточки с записями экрана (Calendly, Curve, Plum), миниатюры телефонов мелкие и без подписей; полные записи, судя по странице, за пробным доступом. Смотреть: как три продукта собирают автоматизацию на телефоне | открыл (глазами) |
| 4 | [Page Flows: price alerts (Venmo)](https://pageflows.com/ios/flows/turning-on-price-alerts/), [recurring buys (Coinbase)](https://pageflows.com/ios/flows/setting-up-recurring-buys/) | По 4 скриншота и запись экрана, подписей нет. Смотреть: поле цены и подтверждение у алерта, сумма и частота у регулярной покупки | открыл |
| 5 | [Google Home: script editor](https://support.google.com/googlehome/answer/13323253) | Путь Automations → Add → Household → Script editor; секции starters / conditions / actions; кнопка Validate, переключатель Activate; с ошибками активировать нельзя; на iPhone новые скрипты не создаются. Скриншотов нет, только мелкие иконки. Перенять: Validate и Activate как два явных шага «проверить, потом включить» | открыл |
| 6 | [Evlop: automation flow](https://evlop.com/blog/evlop-automation-flow) | Trigger + необязательное condition + action; узлы Condition (AND/OR/NOT), Delay, Throttle; один скриншот канваса. Перенять: Throttle и Delay как поля правила | открыл |
| 7 | [Phrase (21st.dev)](https://21st.dev/@ds-spec/components/phrase), [Chipper](https://github.com/philosaether/chipper) | Предложение из слов-пилюль: тап по слову меняет вариант, число тянется вбок, под предложением строка «что это значит»; у Chipper клаузы обязательные и зависимые. Обе React | открыл |
| 8 | [Smashing: dangerous actions](https://www.smashingmagazine.com/2024/09/how-manage-dangerous-actions-user-interfaces), [Baymard](https://baymard.com/blog/handling-accidental-taps-on-touch-devices) | Кнопка называет действие и сумму; review-шаг с отменой; undo не для покупок | открыл |
| 9 | [3Commas](https://3commas.io/) | Три шага на главной со скриншотами (Link exchange, Build / backtest / refine, Let bots work); боты DCA, Signal, Grid, Smart Trade; мобильное приложение для сборки ботов. Экраны создания бота на странице не описаны | открыл |
| 10 | [Bybit: Futures Grid Bot](https://www.bybit.com/en/help-center/article/How-to-Get-Started-with-Futures-Grid-Bot-on-Bybit) | Поля Order Direction (Neutral / Long / Short), Price Range, Number of Grids (2–400, узкий диапазон снижает максимум); «AI Strategy» сама подставляет диапазон, сетку, Profit/Grid и плечо. Перенять: пресет заполняет, человек правит, поля зависят друг от друга | по сниппету (страница не открылась по timeout) |

### Агент создаёт блоки словами

Третий проход, 2026-11-24. Схема у всех: фраза → черновик (шаги, а не готовое действие) → правка → явное «Сохранить / Опубликовать» человеком. Лучшие первыми.

| # | Референс | Как устроен диалог, формат на выходе, граница «агент готовит, человек исполняет» | Статус |
|---|---|---|---|
| 1 | **Выбрано.** Apple Shortcuts iOS 27, углубление: [TechCrunch](https://techcrunch.com/2026/06/08/apple-will-let-you-build-workflows-using-ai-in-its-new-shortcuts-app), [iGeeksBlog](https://www.igeeksblog.com/ios-27-shortcuts-app-features/), [Macworld](https://www.macworld.com/article/3175443/ios-27s-shortcuts-is-ai-at-its-best.html) | Экран начинается с вопроса, что человек хочет сделать, голосовые команды вынесены вперёд; на выходе обычный shortcut из шагов (пример: «leaving work» даёт автоматизацию с адресом, расчётом времени в Apple Maps и сообщением); автор видит каждый шаг и может править руками или просить ИИ уточнить; правку тоже можно словами («добавь подкаст»). Подтверждения и разрешения в этих статьях не описаны; доступна только developer beta. Как выглядит карточка черновика, в текстах нет | открыл |
| 2 | [Google Home: Help me create](https://support.google.com/googlehome/answer/15684131) | Add → Automations → Help me create; текстом или голосом; кнопка Create даёт краткий обзор, затем Ask again (переформулировать) или Continue (проверить). Формат: название, описание, starters, conditions («any» или «all»), actions, каждый раздел правится и подтверждается Save/Done. Автоматизации с ошибками сохраняются выключенными; включение отдельным действием на вкладке Automations. Совет страницы: проверить перед тем, как полагаться | открыл |
| 3 | [Zapier Copilot](https://help.zapier.com/hc/en-us/articles/15703650952077) | Поле запроса над редактором (есть диктовка и вложения); режимы **Auto-build** и **Ask as you build** (предлагает и ждёт подтверждения); сводки в боковой панели и «Show reasoning»; то, что Copilot сделать не может, выписано инструкциями; контрольные точки с Revert. На выходе Zap (триггер + действия); Publish нажимает человек, у Enterprise ещё и админ | открыл |
| 4 | HA Configuration Agent: [пост на форуме](https://community.home-assistant.io/t/introducing-ha-configuration-agent-ai-powered-home-assistant-configuration-assistant-with-approval-workflow/944620) | Каждая правка агента показывается как side-by-side diff, человек принимает или отклоняет каждую; перед записью бэкап с меткой времени; при провале `check_config` откат; `auto_approve` автор помечает «NEVER enable unless testing». Правит YAML. Сторонний аддон, не официальный | открыл |
| 5 | [n8n: MCP-сервер инстанса](https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/) и [n8n-MCP](https://github.com/czlonkowski/n8n-mcp) (MIT, 23299★, 2026-11-23) | Агент ищет, запускает, создаёт и правит workflow; каждый workflow нужно отдельно включить («Available in MCP», автодоступ выключен по умолчанию); запуск по умолчанию только опубликованной версии. В n8n-MCP: правка частичными операциями (`n8n_update_partial_workflow`), `validate_workflow` до деплоя, снимки до каждой правки (до 10) с list / diff / rollback; README советует пробовать на копии | открыл |
| 6 | [Alexa+: routines by voice](https://digprjsurvey.amazon.com/csad/help/node/TR10VgRL0uV9H384FM) (зеркало справки Amazon на необычном домене) | Одна фраза описывает действия и время («...каждый будний день в 7:00»); Alexa сохраняет routine в приложении и сообщает об успехе или ошибках; сразу после создания действия можно добавить, изменить, удалить голосом, дальше только в приложении | открыл |
| 7 | [Composer](https://www.composer.trade/) | Слова о целях, стратегии и рисках → AI-редактор собирает «symphony» (no-code блоки: веса, if/then, sort/filter), всё редактируется; **превью бэктеста** с комиссиями и проскальзыванием, график против бенчмарков. Шага подтверждения перед запуском и paper trading на странице нет | открыл |
| 8 | [Activepieces AI builder (блог вендора)](https://www.activepieces.com/blog/activepieces-ai-workflow-builder-a-2026-review) | Описание → черновик: один триггер, упорядоченные действия, настройки. Человек сверяет с замыслом, подключает аккаунты, мапит поля, гоняет реальную пробную запись, публикует. Прямо сказано: билдер не проверяет, что черновик совпадает с намерением; перед исходящими и разрушающими действиями нужен шаг одобрения человеком | открыл |
| 9 | [n8n AI Workflow Builder](https://docs.n8n.io/advanced-ai/ai-workflow-builder/) | Запрос или пример-подсказка; видно фазы работы, затем проверка кредов и параметров, правки следующими сообщениями, `/clear` сбрасывает контекст; в LLM уходят промпты, определения узлов и текущий workflow, но не креды. Кредит списывается за каждое сообщение | открыл |
| 10 | [Zapier MCP](https://zapier.com/mcp) | Агент ищет нужное действие среди 9000+ приложений и просит недостающие данные перед запуском; человек выбирает, к каким приложениям агент допущен; каждое действие пишется в History; креды остаются на стороне Zapier. Пошагового одобрения действий на странице нет | открыл |
| 11 | [Home Assistant: MCP server](https://www.home-assistant.io/integrations/mcp_server/) | Наборы инструментов на отдельных URL (Device control отдельно от админского); переключатель **Read-only** убирает инструменты, меняющие состояние; OAuth 2.0 с PKCE; некоторые клиенты спрашивают разрешение на вызов. Создаёт ли ИИ автоматизации, страница не говорит | открыл |
| 12 | Make AI Assistant, Relay.app, Gumloop, Lindy ([сравнение Relay](https://relay.app/blog/best-ai-agent-builders)) | Make: ассистент необязателен, видит только то, что дал человек, и текущий сценарий; у Relay заявлены обязательные точки одобрения; всё из выдачи поиска и вендорских блогов | по сниппету (страницы не открывал) |

**Паттерны безопасности для денежных действий**, найденные выше: (1) агент пишет черновик, исполняет человек: Save с ошибками остаётся выключенным (Google Home), Publish руками (Zapier, Activepieces); (2) diff, одобрение каждой правки, бэкап и откат (HA Configuration Agent, снимки в n8n-MCP); (3) валидация до включения (Validate у Google Home, `validate_workflow`); (4) инструменты агента урезаются: Read-only (Home Assistant), включение по одному workflow (n8n); (5) превью последствий с комиссиями и проскальзыванием до запуска (Composer); (6) пошагового одобрения нет у Zapier MCP и не описано у Composer: для денег этого мало.

### Финансовые приложения с алертами и правилами

Лучшие первыми. Экраны смотреть: Page Flows (Venmo, Coinbase) из группы выше; Mobbin, Behance, Cryptohopper, Cash App блокируют ботов.

| # | Референс | Как собирается правило, поля, итог словами, защита от случайного срабатывания | Статус |
|---|---|---|---|
| 1 | [Nansen: AI Smart Alerts](https://academy.nansen.ai/en/articles/6239622-ai-smart-alerts-101) | Описать, что отслеживать, или выбрать готовый промпт → ИИ собирает → кнопка «Create Alert». Типы: Token Transfers, Smart Money Token Flow (порог), Perps Position. Доставка в Telegram, Discord, Slack. Как правятся поля после ИИ и лимиты, статья не описывает | открыл |
| 2 | Otomato: [документация v1](https://otomato.gitbook.io/v1/product-guides/builder-mode-product-overview) | Триггеры: рыночные (движение цены) и ончейн-события; несколько условий через AND; действия выбираются вручную (уведомление, сделка); пример «покупка, когда ETH ниже $1500». Создание из текста не подтверждено: «AI workflow builder» в выдаче оказался другим продуктом (OttoKit). Мобильный вид и шаблоны не видел | не открыл (403 на otomato.xyz и gitbook), по сниппету |
| 3 | [Binance: price alerts](https://www.binance.com/en/support/faq/53349d11525b42f79ff20d3ea1dc312b) | Мобильно 4 шага: Markets → пара → иконка Alert слева внизу → тип → цель и частота → Create Alert; удаление свайпом влево. 7 типов (Price reaches, rises above, drops to, Change over / under в процентах, 24H change over / down). Защита: 10 алертов на пару, 50 всего, срок 90 дней. Нужен Binance Pro | открыл |
| 4 | [Robinhood: crypto price alerts](https://robinhood.com/us/en/support/articles/crypto-price-alerts/) | Типы: Key price levels, Price movements (5% или 10%), Highs and lows (1M до All time); кастомный алерт через колокольчик на странице монеты. Частота **Less** (по умолчанию: не больше 1 в час и 3 в день на монету) и **More**; mute на 1 неделю (по умолчанию), 2 недели, месяц или бессрочно | открыл |
| 5 | [TradingView: alerts](https://www.tradingview.com/support/solutions/43000595315-how-to-set-up-alerts/) | Поля: условие, частота (один раз или много), таймер срока, имя, сообщение с плейсхолдерами, способы уведомления (приложение, pop-up, email, webhook, звук). Экран не видел, только справка | открыл |
| 6 | [Cornix: DCA bot in the app](https://help.cornix.io/en/articles/6823560-dca-bot-on-the-app) | Визард из 5 шагов с кнопками навигации внизу, запуск плюсом внизу справа; на последнем экране Create Bot неактивна, пока настройки невалидны; выбор «создать неактивным» или «создать и сразу запустить» (активный бот открывает первую сделку немедленно) | по сниппету (прямая ссылка дала 404) |
| 7 | [Monarch: transaction rules](https://help.monarch.com/hc/en-us/articles/360048393372) | Settings → Rules: блок «If transactions match» → «Then apply»; вкладка **Preview changes** до применения; правило работает на новых транзакциях; быстрое правило из экрана транзакции. По отзывам пользователей, OR-группировки нет (2024) | по сниппету (403) |
| 8 | thinkorswim: [Schwab Learn](https://www.schwab.com/learn/story/conditional-orders-on-thinkorswim-desktop) | Условный ордер хранится на серверах Schwab, пока условия не выполнены; до трёх условий (на StreetSmart Edge And и Or смешивать нельзя); в Monitor статус «ожидает условие»; не сохраняется как шаблон; отключается через Deactivate | по сниппету (страница дала ошибку авторизации) |
| 9 | [Tenderly: alerts](https://docs.tenderly.co/monitoring/alerts/introduction.md) | Алерт = тип + цель (адреса, сеть, проект) + назначение (до нескольких); 12 типов триггера (Balance Change, Event Emitted, Function Call и др.) и 8 каналов (Email, Slack, Telegram, Discord, Webhooks, PagerDuty и др.); сложные условия только через API | открыл |
| 10 | [3Commas](https://3commas.io/) | Три шага на главной: подключить биржу → собрать, проверить на истории, поправить → запустить; несколько сигналов-условий в одном боте; Smart Trade с трейлинг-стопом | открыл (главная) |

Не нашёл или не открыл: Coinbase (help.coinbase.com отдал 403), Webull, Arkham, Hypernative, Bitsgap, Pionex, Copilot Money, Ramp, Mercury (страниц с правилами не нашёл), Cryptohopper (403).

Не открылось (блокировка): Mobbin, Behance, Cash App, Cryptohopper (403); Dribbble отдал пустую страницу; Refero отдаёт только оболочку. Screenlane перенаправляет на Page Flows.

Части A и B про телефонную страницу, часть C (раздел 6) про приложения для самих очков. Собрано 2026-11-24. Числа по библиотекам: GitHub API и npm registry на эту дату. Страницы читал через WebFetch (ответ пересказывает маленькая модель, поэтому цифры там, где они ключевые, сверял отдельно). Только UI-референсы, не советы по торговле.

## 1. Коротко

- Модель конструктора, которая уже доказана и ложится на телефон: **три слота «Когда → Только если → Тогда»** (Home Assistant, Apple Home, MacroDroid), записанных **одним предложением из пилюль** (IFTTT, Chipper, Phrase). Каждая пилюля открывает bottom sheet с выбором.
- Графовые редакторы (Blockly, xyflow, Rete, Drawflow, n8n, Node-RED) для одной руки на телефоне не подходят, а готовые sentence/query-builder библиотеки либо только React, либо строки с выпадающими списками. Vanilla-аналога пилюльного предложения не нашёл.
- Готовым берём только bottom sheet: `pure-web-bottom-sheet` (MIT, Web Component, без зависимостей).
- Движок и формат правил уже есть (`server/src/rules.ts`); json-rules-engine и JsonLogic нужны лишь как образец формата, не как зависимость.
- Стиль: токены Even в `app/index.html` уже близки к Apple (inset grouped list, blur только на плавающем слое, reduced-motion). Менять надо числа: touch-зона 44 pt, шкала шрифтов, моушн-токены.
- **Топ-3:** (1) предложение из пилюль + sheet-пикеры + строка-пересказ вместо текстового `->` (текст остаётся режимом «Edit as text», как YAML в Home Assistant); (2) денежное действие: пересказ с суммой в самой кнопке, проверка лимита, кнопка «Test on glasses», у каждого правила переключатель и частота «once / every time»; (3) токены: `--hit: 44px`, шкала 34/22/17/15/13, `--dur-*` и одна кривая для sheet.
- **Часть C (очки, раздел 6):** топ-30 каталога Even Hub (Trending) и официальные приложения Even. Лучшее финансовое приложение каталога стоит на 42 месте, в топ-30 денег нет.

## 2. Часть A: стиль

Конфликт с `docs/design.md`: там сказано, что страница использует токены Even, а не имитирует iOS. Предлагаю совместить: палитра и шрифт Even, структура и числа HIG.

| Референс | Что перенять (конкретно) | Что не брать |
|---|---|---|
| [Apple HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | iOS default (проверено по данным страницы): Large Title 34/41, Title 1 28/34, Title 2 22/28, Title 3 20/25, Headline 17/22 semibold, Body 17/22, Footnote 13/18, Caption 1 12/16, Caption 2 11/13. Touch-зона на iOS 44×44 pt по умолчанию, 28×28 минимум; расстояние между контролами важно не меньше размера | Dynamic Type целиком (в webview проще `rem` + системный масштаб) |
| [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Liquid Glass только для слоя контролов и навигации поверх контента, в слое контента не использовать; для контента обычные материалы | Стекло на строках правил и карточках |
| [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) | Sheet для узкой задачи в контексте; кнопки Cancel / Done / Back с разными ролями (Back ведёт по шагам, не закрывает); для долгих потоков лучше не sheet | Вкладывать sheet в sheet: на этом настаивает eBay Playbook (по сниппету поиска, страницу не открывал), в HIG не нашёл |
| [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Моушн только по делу, короткий и точный; не единственный способ сообщить статус; направление анимации повторяет жест | Конкретных spring-чисел на странице нет |
| [Linear: how we redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui) | Тема из трёх входов (база, акцент, контраст) вместо 98 переменных; цвета считаются в LCH для равной светлоты; нейтральная палитра; шум снижали выравниванием, а не украшениями; Inter Display для заголовков, Inter для текста | Плотность десктопной навигации |
| [Things 3: features](https://culturedcode.com/things/features/) | Magic Plus: кнопку тянут и бросают в точку списка, куда нужен новый элемент (идея для «вставить условие здесь»); заголовки как структура списка; анимация раскрытия сохраняет место глаза (по отзывам на странице) | Quick Entry (на странице не описан); пустые состояния не проверял |
| Nothing OS ([обсуждение](https://nothing.community/d/61774-nothing-os-evolution), не открыл; nothing.tech/pages/nothing-os дал 404) | Точечный шрифт только там, где он задаёт характер; в OS 5.0 Nothing сам сузил его применение ради читаемости; монохром; виджет как контрол | Шрифт Ndot закрытый; точечная гарнитура на данных ухудшает чтение |
| [Teenage Engineering](https://teenage.engineering/) | Скупые утилитарные подписи, редкий текст, названия с кодом модели | Строчные заголовки: у проекта правило sentence case; страница не дала шрифтов и цветов |
| [Dieter Rams: 10 принципов (Vitsoe)](https://www.vitsoe.com/gb/about/good-design) | «As little design as possible», «Unobtrusive», «Honest» (не обещать больше, чем делает правило), «Understandable» (интерфейс объясняет себя) | Это принципы, не токены |
| [Copilot Money](https://www.copilot.money/) | Свой цвет и эмодзи на категорию: аналог цветной плитки на тип правила (у вас уже `.tile` с иконкой) | Страница почти без деталей UI, это самый слабый источник в списке |

### Выжимка в токены (сверка с `app/index.html`)

- **Совпадает:** h1 34/700 = Large Title; `.caption` 13 = Footnote; textarea 15 = Subhead; inset grouped list (радиус 12, hairline 0.5px); blur 20px + saturate 180% только на плавающем `#message` (в духе HIG: стекло не в слое контента); `button:active` scale .97 за 100 ms; `prefers-reduced-motion` и `prefers-reduced-transparency` уже учтены; `env(safe-area-inset-bottom)`.
- **Шкала шрифтов:** 34/700 title, 22/600 заголовок sheet, 17/600 кнопки и названия строк, 16–17/400 текст, 15 вторичный, 13 подписи, 12 минимум в рабочем тексте. Сейчас `h2` 11px: это пол HIG (Caption 2), поднять до 12–13.
- **Touch:** `--hit: 44px`. Сейчас числа внутри предложения (`.rule input`) высотой около 25 px при padding 1px: ниже даже минимума 28 pt. У пилюль визуально 32 px, зона нажатия 44 через `::before`.
- **Радиусы:** 8 (поля, плитки) / 12 (группы, кнопки) / 16 (lens) / 20–24 (верх sheet) / pill. Сейчас первые четыре на месте, не хватает токена для sheet.
- **Отступы:** сетка 4/8; `.row` padding 14 вне сетки, брать 12 или 16 (минимальная высота строки 44).
- **Моушн:** завести `--dur-fast: 100ms`, `--dur-base: 200ms`, `--dur-sheet: 320ms` и одну кривую замедления для sheet (например `cubic-bezier(0.32, 0.72, 0, 1)`, часто используется в iOS-подобных sheet; из памяти, не проверено). Пружин сейчас нет; пружина нужна sheet и drag пилюли, остальное остаётся на ease. Для reduced-motion оставить только fade.
- **Материал:** стекло только на sheet-шапке, тосте и плавающей панели; строки и пилюли сплошные.
- **Палитра:** Even (`#232323`/`#FFF`, `#111`/`#1A1A1A`, акцент `#FEF991`, alert `#D93025`/`#FF6B5E`) оставить. Идея Linear: `--color-surface`, `--color-line`, `--color-input-bg` считать из двух переменных через `color-mix` (как уже сделано для `#message`). Решение владельца: нужны ли семантические цвета плюс/минус для превью PnL (зелёный стекол по `design.md` на телефоне не появляется).

## 3. Часть B: конструктор действий

Все ниже, кроме Home Assistant frontend (Apache-2.0) и Activepieces, коммерческие: только референс, ассеты не копировать.

| Референс | Модель | Как ложится на телефон одной рукой | Что перенять |
|---|---|---|---|
| [Apple Shortcuts](https://support.apple.com/guide/shortcuts/welcome/ios) | Список шагов; действие = «один шаг», переменные как токены внутри шага | Родной мобильный редактор | Шаг как карточка; страница «Add import questions to shared shortcuts» (шаблон спрашивает параметры при установке) = пресеты с вопросами. Режим «Ask Before Running» знаю из памяти, на странице не подтвердил |
| [Apple Home: automations](https://support.apple.com/en-in/HT208940) | Визард: триггер → условие → что запустить → Done | Три коротких экрана, один выбор на экране | Триггер выбирается первым и сам определяет доступные условия («People» у времени суток); кнопка «Test This Automation»; переключатель «Enable This Automation» |
| [Home Assistant: automation editor](https://www.home-assistant.io/docs/automation/editor/) ([frontend, Apache-2.0](https://github.com/home-assistant/frontend)) | Три блока строк: триггеры, условия, действия | Строка с меню: rename, duplicate, disable, delete, add note, edit in YAML; перетаскивание за ручку | Ровно ваша структура T→C→A; **YAML-переключатель как запасной выход** (у вас это текущий `buy eth -> ...`); undo/redo; «Continue on error». В репо есть `add-automation-element-dialog.ts` и sortable-list: годится как чтение, не как зависимость (на Lit и привязано к HA) |
| [MacroDroid](https://www.macrodroid.com/) | Триггеры + действия + ограничения (constraints) | Android-приложение, mobile-first (детали редактора на странице не описаны) | «Ограничение» как третий слот; 350+ блоков; магазин шаблонов |
| [TradingView: alerts](https://www.tradingview.com/support/solutions/43000595315-how-to-set-up-alerts/) | Одна форма: условие, частота, срок, имя, сообщение, способы уведомления | Форма в sheet | Поля **frequency (once / многократно)** и **expiration** как обязательные у правила; сообщение с плейсхолдерами; у вас это `fired` + `BAND_PCT` |
| [IFTTT](https://ifttt.com/explore) | Апплет = заголовок-предложение («Add new Spotify liked songs to a playlist») плюс иконки сервисов | Карточка в списке | Заголовок правила одной строкой; на странице механика не описана, почти пусто |
| [Zapier: trigger basics](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-and-action-basics-in-Zaps) | Вертикальный список шагов; «Test trigger» подставляет образец данных | Хорошо (вертикаль) | Пробный прогон с примером данных = ваша кнопка «Test on glasses». Открыл только страницу про trigger |
| [Activepieces](https://github.com/activepieces/activepieces) (MIT кроме каталога `ee`), n8n, Node-RED | Список шагов / граф-канвас | Канвас плохо: мелкие порты, два пальца | Только как контрпример. n8n: лицензия не OSI (Sustainable Use), по API GitHub `NOASSERTION`; страницы n8n и Node-RED не открывал |
| [Chipper](https://github.com/philosaether/chipper) (MIT, 0 звёзд, обновлён 2026-08) | Предложение из пилюль: «Every [2] [weeks] on [tuesday], create…» | Хорошо, но только React | Клаузы: обязательные, опциональные, зависимые от других пилюль. Образец поведения, не зависимость |
| [Phrase от Detent UI на 21st.dev](https://21st.dev/@ds-spec/components/phrase) (MIT, нужен `motion`, React/shadcn) | Предложение-настройка: тап по слову меняет вариант, число тянется вбок, ниже строка «что это значит» | Отлично для одной руки | Жест «тянуть число»; строка-пересказ под предложением (у вас `describeShortcut`) |
| Паттерны подтверждения: [Smashing](https://www.smashingmagazine.com/2024/09/how-manage-dangerous-actions-user-interfaces), [Baymard](https://baymard.com/blog/handling-accidental-taps-on-touch-devices) | Трение по тяжести | Подходит | Кнопка называет действие и сумму («Pay $97», не «Confirm»); «review step» с отменой; undo-тост не для покупок; Baymard: подтверждение/swipe/hold уместны для редких тяжёлых действий; для частых нужен undo. Hold (long press) упоминает только Baymard, как редкую форму подтверждения; Smashing его не разбирает |
| [Bybit: conditional orders](https://www.bybit.com/en/help-center/article/What-Are-The-Pros-And-Cons-Of-Using-LTP-Or-Mark-Price-To-Trigger-Your-Conditional-Orders) (не открыл, по сниппету поиска) | Условие по цене с выбором источника | Поле в sheet | Поле «по какой цене: last / mark» и формулировка «сработало» отдельно от «исполнится по»; ваш движок использует mark |

### Встраиваемые библиотеки

| Имя | Лицензия | Последний релиз | Без React | Вердикт |
|---|---|---|---|---|
| [pure-web-bottom-sheet](https://github.com/viliket/pure-web-bottom-sheet) | MIT | 1.1.1, npm 2026-10-09 | Да (Web Component, CSS scroll snap, native `<dialog>`/Popover, зависимостей нет, около 200 KB в npm) | **Брать для sheet.** Проверить в webview приложения Even: ядро на scroll-driven animations, README обещает запасной JS-путь |
| [SortableJS](https://github.com/SortableJS/Sortable) | MIT | 1.15.7, 2026-02-11 | Да | Только если понадобится перестановка шагов; для одного T→C→A не нужен |
| [json-rules-engine](https://github.com/CacheControl/json-rules-engine) | ISC | npm 7.3.1, 2025-02-20; последний коммит 2026-02-16 | Да, 17 KB gz, без eval | Не ставить (движок уже есть). Образец формата `all`/`any` + `event` |
| [json-logic-js](https://github.com/jwadhams/json-logic-js) | MIT | 2.0.5, 2024-07-09 | Да, без зависимостей | Не ставить. Образец хранения условий; релиз старше года |
| [react-querybuilder](https://github.com/react-querybuilder/react-querybuilder) | MIT | 8.28.0, 2026-11-20 | Нет (порты Solid/Svelte/Vue; есть пакет rules-engine для if-then-else) | Нет: строки с выпадающими списками, тянет redux |
| [react-awesome-query-builder](https://github.com/ukrbublik/react-awesome-query-builder) | MIT | 6.6.15, 2025-05-16 | Нет | Нет |
| [jQuery-QueryBuilder](https://github.com/mistic100/jQuery-QueryBuilder) | MIT | 3.0.0, 2024-01-31 | jQuery | Нет, устарел, десктопный |
| [Blockly](https://github.com/RaspberryPiFoundation/blockly) | Apache-2.0 | 13.5.0, 2026-11-19 | Да, зависимостей нет, но 17.6 MB в npm (бандл не мерил) | Нет: блоки-пазлы тяжёлые для одной руки и избыточны для T→C→A |
| [xyflow / React Flow](https://github.com/xyflow/xyflow) | MIT | `@xyflow/react` 13.0.3, 2026-11-23 | Нет (React/Svelte/Vue; `@xyflow/system` на d3 без рендера) | Нет: граф-канвас; просят оставить ссылку-атрибуцию |
| [Rete.js](https://github.com/retejs/rete) | MIT | v2.0.6, 2025-06-30 (area-plugin 2026-07; `rete-lit-plugin` 2023-08, заброшен) | Ядро да, рендереры под фреймворки | Нет: граф, рендерер Lit устарел |
| [Drawflow](https://github.com/jerosoler/Drawflow) | MIT | 0.0.60, 2024-09-03 | Да, 65 KB в npm | Нет: граф и старше года |
| [Ionic Modal](https://github.com/ionic-team/ionic-framework) | MIT | 9.0.13, 2026-11-20 | Да (Stencil), 21 MB в npm | Нет: тяжело ради одного sheet |
| Vaul | MIT | v1.1.2, 2024-12-14 | Нет (React) | Нет |

GPL/AGPL среди проверенных нет.

## 4. Вердикт reuse-first

- **Часть A (стиль): Adapt.** Токены Even в `app/index.html` уже покрывают около 70% (grouped list, blur на плавающем слое, reduced-motion); меняем числа по HIG и вводим `--hit`, `--dur-*`, радиус sheet.
- **Часть B (конструктор): Compose, где ядро Build.** Bottom sheet берём готовый (`pure-web-bottom-sheet`), строки-пересказы уже есть (`describeShortcut`, `describeAlert`), движок на сервере. Build для самого предложения из пилюль: ближайшие Chipper и Phrase только React (README Chipper: «React library», Phrase ставится через shadcn и требует `motion`), query-builder'ы показывают строки с селектами и тоже на React, графовые Blockly/Rete/xyflow/Drawflow неудобны на телефоне и тяжёлые; vanilla или Web Component-аналога пилюльного предложения я не нашёл.

## 5. Что не удалось проверить

- **Страницы не открылись или ничего не дали:** nothing.tech/pages/nothing-os (404); HIG в HTML (JS-оболочка, данные взял из публичного JSON `developer.apple.com/tutorials/data/design/human-interface-guidelines/*.json`, он не документирован); Zapier (общая «Zap basics» оказалась страницей про SCIM, нашёл только trigger basics); Make (`help.make.com` дал лишь «Get started», канвас сценария не подтверждён); Apple Shortcuts «Add automations» (шагов на странице нет).
- **Только по поисковым сниппетам, страницы не открывал:** Bybit conditional orders, Bybit Futures Grid Bot (timeout), eBay Playbook. Во втором проходе открыты: Alexa Routines ([developer.amazon.com](https://developer.amazon.com/en-US/alexa/alexa-haus/routines): один триггер, время или голосовая фраза, условий на странице нет, экранов нет) и токены сайта Nothing на shadcn.io.
- **Страницы открыты, но почти без UI-деталей:** IFTTT, MacroDroid, Oura, Rabbit r1, Raycast, Copilot Money, Craft, Things 3 (отзывы), Teenage Engineering (нет шрифтов и цветов). Oura, Rabbit r1, Raycast, Craft в таблицу не вошли.
- **Не исследовано:** Cash App (403), Cryptohopper (403), Mobbin (403), Behance (403), Dribbble (пусто), Refero (только оболочка), Apple Weather и Clock (отдельных страниц не нашёл), Apple Home как экраны (только текст поддержки), Tasker (на главной четыре скриншота названы лишь по имени файла), Make (канвас), Node-RED и n8n по страницам, Figma Community (поиск вернул только общие iOS-киты, kit для конструктора правил не нашёл). Arc: страница теперь про переход на Dia, как референс не брал. Humane: Ai Pin закрыт 2025-02-28, HP купила активы, только исторический интерес. Awesome-списки (frenck/awesome-home-assistant, CC-BY-4.0; restyler/awesome-n8n, без лицензии) знаю лишь по метаданным GitHub.
- **Не проверено вообще:** кривая `cubic-bezier(0.32, 0.72, 0, 1)`, работа scroll-driven animations в webview приложения Even, размер бандла Blockly.
- Скрипт `search.py` для запросов про builder и trading-alert по GitHub вернул «nothing found», основной отбор библиотек сделан через `gh api` и npm registry; поиск не насыщен: три круга снежного кома по Alternatives/awesome-спискам (n8n, Activepieces, Node-RED) не делал.

## 6. Часть C: приложения для очков, топ и официальные

Собрано 2026-11-24 для линзы, не для телефона. Источник: публичный каталог Even Hub, [hub.evenrealities.com/catalogue](https://hub.evenrealities.com/catalogue) и JSON его витрины (`/api/v1/storefront/discovery`, `/list`, `/detail`). В каталоге 1105 приложений. По [правилам рейтинга Even](https://support.evenrealities.com/hc/en-us/articles/17713487224079-How-Even-Hub-Recommends-and-Ranks-Plug-ins) (от 24.09.2026) Trending упорядочен по числу установок за недавний период, Fresh по дате первого выпуска. Сами числа установок каталог не показывает. Экраны приложений собраны отдельной страницей-галереей (временный файл сессии, в репозиторий не входит).

### Топ-30 каталога Even Hub

Места 1–10 это официальный список Trending. Места 11–30 идут следом в порядке выдачи каталога: на первых десяти местах он совпадает с Trending, а дальше порядок Even не описывает, так что это допущение.

| # | Приложение | Автор | Категория | Что делает (описание из каталога) |
|---|---|---|---|---|
| 1 | [Weather](https://hub.evenrealities.com/catalogue/com.nickustinov.weatherapp) | Nick Ustinov | Lifestyle | Weather forecasts |
| 2 | [OcuClaw](https://hub.evenrealities.com/catalogue/com.akelu.ocuclaw) | Akelu | AI | Agentic AI for G2. Any model. Private. Yours. |
| 3 | [Navigaze](https://hub.evenrealities.com/catalogue/com.gaze.app) | Sufi | Travel | Turn-by-turn directions for drive, bike and walk |
| 4 | [DisplayPlus Music](https://hub.evenrealities.com/catalogue/com.oliemanq.displayplusmusic) | Oliemanq | Music | A music viewer with album art, lyrics, and more! |
| 5 | [Books](https://hub.evenrealities.com/catalogue/com.books.eveng2) | Nick Ustinov | Lifestyle | Read 70,000+ free classics or your own ePubs |
| 6 | [Live News](https://hub.evenrealities.com/catalogue/com.mrvr.mirairadio) | MRVR | Lifestyle | Weather / AI / Games & Tools — Streamed to You |
| 7 | [Timer](https://hub.evenrealities.com/catalogue/com.giova.timer) | QDG_John | Productivity | Countdown timer with layout control |
| 8 | [Messages](https://hub.evenrealities.com/catalogue/solutions.pleiades.evenmessages) | Thibaut Rey | Lifestyle | View and answer to all your messages and socials |
| 9 | [Visionote](https://hub.evenrealities.com/catalogue/company.takashi.visionote) | takashicompany | Utilities | Display your photos, illustrations, and note |
| 10 | [IRIS](https://hub.evenrealities.com/catalogue/com.irispublic.assistant) | Sufi | AI | Your super-powered personal assistant. |
| 11 | [Aside](https://hub.evenrealities.com/catalogue/com.samdavila.aside) | SamX | AI | Know everything. Quietly. |
| 12 | [Voice Recorder](https://hub.evenrealities.com/catalogue/com.wingchan.voicerecorder) | Wing chan | Utilities | Record microphone audio locally |
| 13 | [Lyric Lens](https://hub.evenrealities.com/catalogue/com.theonlydoublee.lyrlens) | TheOnlyDoubleE | Music | Identify songs and see synced lyrics live |
| 14 | [ER Browser](https://hub.evenrealities.com/catalogue/com.evenbrowser.g2) | F3TCH | Education | Read the web on your glasses |
| 15 | [Notes](https://hub.evenrealities.com/catalogue/com.notes.eveng2) | Nick Ustinov | Lifestyle | Hands-free notes, checklists, and voice memos |
| 16 | [Sensemaker](https://hub.evenrealities.com/catalogue/com.sensemaker.sensemakerg2eh06020260402) | Brenden | Productivity | Make sense of notes-to-self, lists, meetings... |
| 17 | [Fluent](https://hub.evenrealities.com/catalogue/com.fluent.app) | Sufi | Education | Flashcards and speaking practice on your glasses |
| 18 | [Cyberpunk HUD](https://hub.evenrealities.com/catalogue/com.matthewspokes.cyberpunkhud) | SPOKES | Lifestyle | A cyberpunk style HUD with essential info. |
| 19 | [Chess](https://hub.evenrealities.com/catalogue/com.harmon.chess) | Dustin Harmon | Entertainment | Play vs Stockfish, try Bullet Blitz, or use the Ac |
| 20 | [Thought Partner](https://hub.evenrealities.com/catalogue/com.rhysmarshall.onetoonecoach) | Rhys Marshall | Productivity | Real-time prompts for better thinking & decisions |
| 21 | [ConDash](https://hub.evenrealities.com/catalogue/com.contionmig.condash) | ContionMig | Utilities | Your customizable G2 dashboard for daily life use. |
| 22 | [Pomodoro Timer](https://hub.evenrealities.com/catalogue/xyz.shibomb.evenpomodoro) | shibomb | Productivity | Simple Pomodoro Timer |
| 23 | [PixelPet](https://hub.evenrealities.com/catalogue/com.evenrealities.tamagotchi) | Morfeus_Session | Entertainment | A classic virtual pet on your Even G2 |
| 24 | [saleseye-universal](https://hub.evenrealities.com/catalogue/com.saleseye.universal) | Caleb Phipps | AI | Your AI sales mentor |
| 25 | [DocuLens](https://hub.evenrealities.com/catalogue/com.doculens.reader) | Jeroen Ceyssens | Productivity | Document reader application with progress tracking |
| 26 | [enkiRIDION](https://hub.evenrealities.com/catalogue/com.d3hospitality.sophicon) | D3 Hospitality | AI | Philosphy on Glass. Think / See / Know. |
| 27 | [Code Rain](https://hub.evenrealities.com/catalogue/com.dmi3.coderain) | dmi3 | Entertainment | Matrix rain, now on your glasses. |
| 28 | [VoiceInk](https://hub.evenrealities.com/catalogue/com.zijiechen.voiceink) | Zijie | Productivity | Real-time bilingual speech-to-text app. |
| 29 | [Local LLM](https://hub.evenrealities.com/catalogue/com.alexc.localllm) | Alex Christie | AI | Your models. Your server. Your glasses. |
| 30 | [Chesly: All Messages](https://hub.evenrealities.com/catalogue/com.chesly.g2) | Nino | Productivity | Chats and email on your G2. No computer needed. |

Выбор редакции Even: OcuClaw, Messages, Books, Live News, Weather. Свежие (Fresh): I-Translate, Foxy 万年历, Next Train Taiwan, GitGlass, Blueglass, DKST RSVP, Live Lyrics, Ready Steady Read, G2 Golf, Stu.Do.

Что видно (по названиям и описаниям каталога; экраны смотрел в галерее):
- В топ-10 нет ничего про деньги: погода, ИИ-помощники, навигация, музыка, книги, новости, таймер, сообщения, заметки с фото. Первое место, Weather, показывает девять экранов, на каждом одна тема, крупные цифры и полоски из линий вместо графика.
- Финансовые приложения в каталоге есть, но низко (место в порядке выдачи): ER Market 42, Crypto Ticker 164, Gazua!! (한국주식) 210, Firefly III 256, Market Dashboard 277, FX Lens 339, Stock Tracker Pro 340, My Markets 346, Robinhood Trading 363, Candles 705, Baykaldi Trading App 802. Найдено поиском по ключевым словам в названии и описании, полноту не гарантирую. У Robinhood Trading описание «Review trades on G2», остальные про котировки и графики.
- Первые 30 мест занимают в основном приложения общего назначения. Приложений вида «правило сработало, один вопрос, один тап» с торговлей в топе нет.

### Официальные приложения Even Realities

Источники: [листинг App Store](https://apps.apple.com/us/app/even-realities/id6747017725), [страница очков](https://www.evenrealities.com/en-US/smart-glasses), [9to5Google](https://9to5google.com/2026/03/26/even-realities-even-hub-apps-and-better-conversate-mode/), [Android Authority](https://www.androidauthority.com/even-realities-g2-smart-glasses-apps-3654769). Страницу поддержки Even открыть не удалось (403).

- **Встроены в очки и приложение Even:** Conversate (подсказки по терминам, субтитры, итоги встречи; с марта 2026 Prep Notes: загруженные документы подмешиваются во время разговора), Even AI («Hey Even»), Translate (35 языков), Navigate, Teleprompt, Dashboard (настраиваемые виджеты), QuickList (задача голосом с датой), Notification, Health. Про две последние в источниках только название.
- **Показаны при запуске Even Hub** (автор в источниках не указан): читалка EPUB, тренировки, индикатор зарядки Tesla, погода, индикатор акций, шахматы, Stillness (дыхание), табло общественного транспорта, тамагочи-подобное приложение.
- **Официальный код** (github.com/even-realities): [EvenDemoApp](https://github.com/even-realities/EvenDemoApp) 474 ★, [everything-evenhub](https://github.com/even-realities/everything-evenhub) 79 ★, [evenhub-templates](https://github.com/even-realities/evenhub-templates) 57 ★ (шаблоны minimal, asr, image, text-heavy), [EH-InNovel](https://github.com/even-realities/EH-InNovel) 15 ★ (веб-демо читалки), enterprise SDK.
