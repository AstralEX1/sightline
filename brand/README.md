# Trade Shortcuts · бренд

Здесь только логотип и цвета. Всё остальное — по Apple.

## Принципы

- **Интерфейс:** [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/).
- **Экран шорткатов:** как приложение Apple Shortcuts — цветные плитки, одна плитка на шорткат, тап запускает, долгое нажатие открывает редактор ([Shortcuts User Guide](https://support.apple.com/guide/shortcuts/welcome/ios)).
- **Линза G2:** правила Even Hub для экрана очков.

## Логотип

Файлы в `logo/`, SVG.

| Файл | Где |
|---|---|
| `tradeshortcuts-wordmark.svg` / `-on-dark.svg` / `-mono-black.svg` / `-mono-white.svg` | Основной логотип: «trade shortcuts», Inter Regular |
| `tradeshortcuts-symbol.svg` / `-on-dark.svg` / `-mono.svg` | Символ: пиксельный ящик с оранжевой защёлкой |
| `tradeshortcuts-lockup.svg` / `-on-dark.svg` | Символ + вордмарк |
| `tradeshortcuts-app-icon.svg` / `-rounded.svg` / `-lens.svg` | Иконка приложения 1024 |
| `favicon.svg` | Вкладка браузера |
| `tradeshortcuts-evenhub-icon.svg` | Иконка в Even Hub: 24 × 24, `currentColor` |

Не растягивать, не поворачивать, без теней и градиентов; защёлку не красить в зелёный или красный.

## Цвета

Нейтрали из Even Hub, акцент — оранжевый Bybit.

| Цвет | HEX | Роль |
|---|---|---|
| White | `#FFFFFF` | Светлая тема: карточки |
| Paper | `#F4F4F4` | Светлая: фон. Тёмная: текст |
| Line | `#D3D3D3` | Светлая: линии |
| Mute | `#A7A7A7` | Тёмная: второй текст |
| Grey | `#656565` | Светлая: второй текст |
| Edge | `#3E3E3E` | Тёмная: линии |
| Card | `#2E2E2E` | Тёмная: карточки |
| Ink | `#232323` | Светлая: текст. Тёмная: фон |
| Black | `#000000` | Только фон линзы |
| Orange | `#FFB11A` | Акцент Bybit: главная кнопка, защёлка в логотипе. Текст на нём — Ink |
| Green | `#2E9B57` | Исполнено, рост — иконки и ▲ |
| Red | `#FF453A` | Отклонено, падение, ликвидация — иконки и ▼ |
| Lens | `#4AF626` | Только экран линзы, на чёрном |

## Цвета шорткатов

Заливки плиток сняты со скриншотов Apple Shortcuts, одинаковые в обеих темах. Цвет плитки = действие шортката. В коде — `--act-*` в `app/src/phone/phone.css`.

| Действие | HEX | Переменная |
|---|---|---|
| Стоп | `#B17DDF` | `--act-stop` |
| Закрыть позицию | `#F56472` | `--act-close` |
| Добавить маржу | `#228FF7` | `--act-margin` |
| Нарастить позицию | `#4CC961` | `--act-grow` |
| Отменить ордер | `#F3AE54` | `--act-cancel` |
| Уведомить | `#4BC7DB` | `--act-notify` |
