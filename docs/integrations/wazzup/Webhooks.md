Webhooks

Вебхуки отправляем методом POST на указанный URI. Он может включать в себя query string.

Если у нас есть ваш crmKey, мы добавляем заголовок Authorization: Bearer ${crmKey}. Если нет — не добавляем заголовок Authorization вообще.

Вебхуки содержат в теле JSON и соответствующий заголовок Content-Type: application/json; charset-utf-8. В JSON закодирован объект со свойствами, которые соответствуют типам вебхуков.

Вебхуки о новых сообщениях и изменении их статуса могут содержать объекты messages и statuses одновременно. Вебхук о необходимости создать контакт или сделку содержит только один объект: createContact или createDeal.

В ответ ожидаем код 200 OK. В некоторых случаях ждем определенную информацию в теле ответа. Таймаут — 30 с.
Как подключить вебхуки

Чтобы подписаться на вебхуки, вызовите:

PATCH https://api.wazzup24.com/v3/webhooks

В теле должен быть JSON с параметрами:
Параметр 	Тип 	Описание
webhooksUri 	String 	Адрес для получения вебхуков. Не более 200 символов
subscriptions 	Object 	Настройки вебхуков
subscriptions.messagesAndStatuses 	Boolean 	Вебхук о новых сообщениях и вебхук об изменении статуса исходящих.

Если вебхук нужен, укажите true. Если нет — false.
subscriptions.contactsAndDealsCreation 	Boolean 	Вебхук о том, что нужно создать новый контакт или сделку.

Если вебхук нужен, укажите true. Если нет — false.
subscriptions.channelsUpdates 	Boolean 	Вебхук об изменении статуса канала.

Если вебхук нужен, укажите true. Если нет — false.
subscriptions.templateStatus 	Boolean 	Вебхук об изменении статуса модерации шаблона WABA.

Если вебхук нужен, укажите true. Если нет — false.

При подключении на указанный url будет отправлен тестовый POST запрос с телом {test: true }. В ответ сервер должен вернуть 200 при успешном подключении вебхуков. Иначе вернется ошибка: Webhooks request not valid. Response status must be 200.
Пример запроса

curl --location --request PATCH 'https://api.wazzup24.com/v3/webhooks' \
--header 'Authorization: Bearer w11cf3444405648267f900520d454368d27' \
--header 'Content-Type: application/json' \
--data-raw '{
"webhooksUri": "https://example.com/webhooks",
"subscriptions": {
"messagesAndStatuses": true,
"contactsAndDealsCreation": true
}
}'

Пример ответа

{
ok
}

Ошибки

Помимо общих ошибок для всех роутов могут быть:
Ошибка 	Описание
400 Bad Request, { error: 'uriNotValid', description: 'Provided URI is not valid URI' } 	При неверном по формальным признакам URI
400 Bad Request, { error: 'testPostNotPassed', description: 'URI does not return 200 OK on test request', data: { '${код ответа}' } } 	Если была получена ошибка при отправке тестового запроса на указанный URL
Проверка адреса для получения вебхуков

Чтобы проверить установленный адрес для получения вебхуков, вызовите:

GET https://api.wazzup24.com/v3/webhooks

Пример ответа

HTTP/1.1 200 OK
```json
{
"webhooksUri": "https://example.com/webhooks",
"subscriptions": {
"messagesAndStatuses": "true",
"contactsAndDealsCreation": "true"
}
}
``

Вебхук о новых сообщениях, изменении и удалении сообщения

Вебхук пришлет JSON-объект с ключом messages, в значении которого лежит массив объектов со следующими параметрами:
Параметр 	Тип 	Описание
messageId 	String (uuid4) 	guid сообщения в Wazzup
channelId 	String (uuid4) 	ID канала
chatType 	String 	Тип чата. Доступные значения:

    whatsapp — для индивидуальных чатов в WhatsApp,
    whatsgroup — для групповых чатов в WhatsApp,
    viber — для чатов viber,
    instagram* — для чатов в Инсте*,
    telegram — для индивидуальных чатов в Telegram,
    telegroup — для групповых чатов в Telegram,
    vk — для чатов Вконтакте,
    avito — для чатов Авито
    max — для индивидуальных чатов MAX
    maxgroup — для групповых чатов MAX

chatId 	String 	ID чата (аккаунт контакта в мессенджере):

    для whatsapp и viber — только цифры, без пробелов и специальных символов в формате 79011112233,
    для instagram* — аккаунт без @ вначале,
    для whatsgroup — ID чата,
    для telegram, max — GUID приходит в вебхуках входящих сообщений и в ответ на запрос при отправке исходящего с параметрами phone, а также username для Telegram

avitoProfileId 	String 	Id профиля Авито. Не то же, что chatId.

avitoProfileId всегда один и тот же для аккаунта Авито, chatId — уникальный для чата. То есть у одного и того же avitoProfileId могут быть разные chatId.
dateTime 	String 	Время отправки сообщения, указанное мессенджером в формате yyyy-mm-ddThh:mm:ss.ms
type 	String 	Тип сообщения:

    text— текст,
    image — изображение,
    audio — аудио,
    video — видео,
    document — документ,
    vcard — карточка контакта,
    geo — геолокация,
    wapi_template — шаблон WABA,
    unsupported — неподдерживаемый тип,
    missing_call — пропущенный звонок,
    иначе — unknown — неизвестная ошибка.

isEcho 	Boolean 	Если сообщение входящее — false. Если исходящее — true
contact 	Object 	Информация о контакте
contact.name 	String 	Имя контакта
contact.avatarUri 	String 	URI аватарки контакта. Прикладывается, если аватарка есть у Wazzup
contact.username 	String 	Только для Telegram.

username (имя пользователя) контакта в Telegram, без @ в начале
contact.phone 	String 	Только для Telegram, MAX. Телефон контакта в международном формате
text 	String 	Текст сообщения. Может отсутствовать, если сообщение с контентом
contentUri 	String 	Ссылка на контент сообщения. Может отсутствовать, если сообщение не содержит контента
status 	String 	Содержит в себе только значение из ENUM из вебхука statuses:

    sent — отправлено (аналог одной серой галки),
    delivered — доставлено (аналог двух серых галок),
    read — прочитано (аналог двух голубых галок),
    error — ошибка,
    inbound — входящее сообщение.

error 	Object 	Приходит, если status: error
error.error 	String 	Код ошибки:

    BAD_CONTACT — для WhatsApp и Telegram: аккаунта с таким chatId не существует;
    CHATID_IGSID_MISMATCH — для Instagram*: аккаунт Instagram* с таким chatId не существует. Возможно, клиент изменил имя профиля;
    TOO_LONG_TEXT — слишком длинный текст сообщения;
    BAD_LINK — фильтры Instagram* не пропускают сообщение из-за ссылки;
    TOO_BIG_CONTENT — размер файла не должен превышать 50 Мб;
    SPAM — сообщение не отправлено из-за подозрения на спам;
    TOO_MANY_EXT_REQS — отправка прервана. С аккаунта поступило слишком много сообщений;
    WRONG_CONTENT — контент файла не подходит под параметры Instagram*;
    MESSAGE_CANCELLED — отправка сообщения прекратилась;
    24_HOURS_EXCEEDED — 24-часовое диалоговое окно WABA закрыто;
    COMMENT_DELETED — комментарий в Instagram* был удален;
    MENTION_FORBIDDEN —нельзя отмечать пользователя, которого пытаются отметить;
    CONTENT_CONVERSION_ERROR — контент не удалось конвертировать;
    MESSAGE_DELETED — сообщение удалено отправителем;
    CHANNEL_REJECTED — сообщение не отправлено, потому что канал забанен;
    CHATID_IGSID_MISMATCH - для каналов Instagram*: не удалось сопоставить ChatId с IGSID;
    7_DAYS_EXCEEDED — 7-дневное диалоговое окно Instagram* закрыто;
    COMMENT_ALREADY_PRIVATE_REPLIED — на этот комментарий в Instagram* уже ответили в директ;
    COMMENT_INVALID_FOR_PRIVATE_REPLY — невозможно ответить на этот комментарий в Instagram* в директ;
    COMMENT_CAN_BE_TEXT_ONLY — на комментарий в Instagram* можно отвечать только в текстовом формате;
    CANNOT_REPLY_TO_DELETED — нельзя ответить на сообщение, потому что пользователь его удалил;
    GENERAL_ERROR — произошла ошибка. Информация уже направлена разработчикам Wazzup;
    UNKNOWN_ERROR — произошла неизвестная ошибка. Повторите попытку позже.

error.description 	String 	Описание ошибки
authorName 	String 	Имя пользователя, отправившего сообщение, если оно есть. Может быть только у сообщений isEcho == true
authorId 	String 	Идентификатор пользователя CRM
instPost 	Object 	Информация о посте из Instagram*. Прикладывается к комментарию в Instagram*
interactive 	Interactive 	Массив объектов с кнопками Salesbot amoCRM прикрепленных к сообщению
quotedMessage 	Object 	Cодержит в себе объект с параметрами цитируемого сообщения
sentFromApp 	Boolean 	Если сообщение было отправлено из нативного чата приложения Wazzup, то параметр принимает значение true, иначе — false
isEdited 	Boolean 	Показывает, что сообщение отредактировано: если true, то сообщение изменено.

Если исходящее сообщение изменено не через Wazzup, а напрямую из мессенджера, то придет вебхук про обновление статуса statuses
isDeleted 	Boolean 	Показывает, что сообщение удалено: если true, то сообщение удалено
oldInfo 	Object 	Содержит информацию об измененном или удаленном сообщении
oldInfo.oldText 	String 	Текст сообщения до редактирования или удаления
oldInfo.oldAuthorId 	String 	id автора, который отправил исходное сообщение.

Может отличаться от authorId, если сообщение изменил, удалил не автор, а другой сотрудник
oldInfo.oldAuthorName 	String 	Имя автора, который отправил исходное сообщение.

Может отличаться от authorName, если сообщение изменил, удалил не автор, а другой сотрудник
Вид объекта с информацией о посте Instagram*

{
id: '2430659146657243411_41370968890',
src: 'https://www.instagram.com/p/CG7b52ejyET',
sha1: 'dc8c036b4a0122bb238fc38dcb0391c125e916f2',
likes: 0,
author: 'wztestdlv',
comments: 22,
timestamp: 1603977171000,
updatedAt: 1608905897958,
authorName: '',
authorId: '78596324',
description: 'Красота',
previewSha1: '3a55c2920912de4b6a66d24568470dd4ad367c34',
imageSrc: 'https://store.dev-wazzup24.com/dc8c036b4a0122bb238fc38dcb0391c125e916f2',
previewSrc: 'https://store.dev-wazzup24.com/3a55c2920912de4b6a66d24568470dd4ad367c34'
}

Стикеры, полученные с канала WhatsApp, отправляем в вебхуке "type": "image" и ссылку с файлом в формате .was:

{
  "messages": [
    {
      "messageId": "6a2087e8-e0f4-9999-b968-9d9999933c81",
      "dateTime": "2025-05-06T14:16:00.002Z",
      "channelId": "b96a353b-9999-4cac-8413-ba99999f981",
      "chatType": "whatsapp",
      "chatId": "79999999999",
      "type": "image",
      "isEcho": false,
      "contact": {
        "name": "79999999999",
        "avatarUri": "https://store.wazzup24.com/0e999997ae07d2083c687253b8baed9999a26fa";
      },
      "contentUri": "https://store.wazzup24.com/e51159999e0046d628b3924161d411e5812d2546/?filename=f9ebe1b1-3ed5-4ec2-97fb-03f0c25e413f.was";,
      "status": "inbound"
    }
  ]
}

Опрос, полученный с канала WhatsApp, отправляем в вебхуке "type": "text" и присылаем опрос в формате текстового сообщения:

{
  "messages": [
    {
      "messageId": "caa9999-cce3-424c-86cd-05f99995073",
      "dateTime": "2025-05-06T14:18:00.001Z",
      "channelId": "b96a999e-06f5-4cac-8413-ba999993f981",
      "chatType": "whatsapp",
      "chatId": "79999999999",
      "type": "text",
      "isEcho": false,
      "contact": {
        "name": "79999999999",
        "avatarUri": "https://store.wazzup24.com/0e82ead97ae07d9999c687253b8baed2365a26fa";
      },
      "text": "Тестовый\n• Вариант1\n• Вариант2",
      "status": "inbound"
    }
  ]
}

Вебхук про обновление статусов исходящих сообщений

Вебхук отправляет JSON-объект с ключом statuses, содержащий массив объектов со следующими параметрами:
Параметр 	Тип 	Описание
messageId 	String 	guid сообщения в Wazzup
timestamp 	String 	Время получения информации об обновлении статуса
status 	String 	Обновленный статус сообщения. Значения:

    sent: отправлено
    delivered: доставлено
    read: прочитано
    error: ошибка
    edited: сообщение отредактировано. Вебхук с этим статусом приходит, только если сообщение отредактировано через мессенджер, а не чат Wazzup. Иначе придет вебхук messages

error 	Object 	Приходит, если status: error
error.error 	String 	Код ошибки
error.description 	String 	Описание ошибки
error.[data] 	String 	Дополнительная информация об ошибке

{
"statuses": [
{
"messageId": "be3dc577-60c4-4fc8-83a5-8c358e0bfe15", // guid сообщения, об обновлении статуса которого мы оповещаем
"timestamp": "2025-02-05T06:01:07.499Z", // время получения информации об обновлении статуса
"status": "delivered"
}
]
}

Вебхуки о том, что нужно создать новый контакт, сделку

Отправляем, когда нужно создать контакт или сделку в CRM. Это происходит в 3 случаях:

Кейс 1: в п. 3 настроек интеграции выбрано «Нового клиента получает первый ответивший менеджер».

Пишет новый клиент. Сотрудник ему отвечает. Wazzup отправляет вебхук о создании нового контакта и сделки на первое исходящее, если из CRM загружены воронки с этапами.

Вебхук отправляем, только если получили id сотрудника, который ответил на сообщение нового клиента.

Кейс 2: в п. 3 настроек интеграции выбрано «Менеджеры получают новых клиентов по очереди».

Пишет новый клиент. Wazzup отправляет вебхук о создании нового контакта и сделки на первое входящее, если из CRM загружены воронки с этапами.

Чтобы вебхуки приходили в первом и втором кейсах, нужно в ЛК добавить сотрудников и включить кому-то из них в настройках интеграции ползунок «Получает новых клиентов».

Кейс 3: при нажатии на кнопку «+» в списке «Сделки» для создания сделки:

Мы проверяем, создан ли контакт у нас в базе.

Если контакт уже создан, мы отправляем вебхук о необходимости создания сделки:

{ 
createDeal: { 
responsibleUserId: '1', // id выбранного по очереди или первого ответившего пользователя 
contacts: ['1'] // связь сделки с новым контактом 
source: 'auto'|'byUser', // auto - при входящем или исходящем, byUser - по кнопке в списке «Сделки» 
}, 
}

Если контакт отсутствует, мы сначала отправляем вебхук о необходимости создания контакта:

{
createContact: {
responsibleUserId: '1', // id выбранного по очереди или первого ответившего пользователя
name: 'contacts.name', // имя контакта из таблицы contacts
contactData: [{ chatType, chatId }],
source: 'auto'|'byUser', // auto - при входящем или исходящем, byUser - по кнопке
},
}

После этого CRM должна создать контакт и вернуть в ответе 200 OK с JSON-объектом новой сущности, соответствующим сигнатуре CRUD-роутов контактов.

Затем мы отправим вебхук о необходимости создания сделки.

После чего CRM должна создать сделку и аналогично вернуть 200 OK с JSON-объектом, соответствующим сигнатуре CRUD-роутов сделок.

Если сделка контакт, сделка уже созданы, то Wazzup не отправит повторно вебхук, даже если сделка закрыта: "close": "true"
Изменение статуса канала или Tier у WABA-аккаунта
Параметр 	Тип 	Описание
channelId 	String 	guid канала
state 	String 	Cтатуса канала
tier 	String 	Только для каналов WABA.

Meta* присваивает аккаунтам WhatsApp Business уровни — они показывают, сколько 24-часовых переписок можно начать сутки.

Возможные значения:

    TIER_0: 250 переписок,
    TIER_1K: 1000 переписок,
    TIER_10K: 10 000 переписок,
    TIER_100K: 100 000 переписок,
    TIER_UNLIMITED: без ограничений.

qr 	String 	QR-код в формате base64, присутствует только при state 'qr'
qridle 	String 	канал разавторизован или QR-код протух
timestamp 	Integer 	Время установки статуса в мс
Пример

{
    "channelsUpdates": [
        {
            "channelId": "d9e5721c-ce2b-444f-9627-60a8129d7e1f",
            "state": "qr",
            "timestamp": 1603977171000,
            "qr": "data:image/png;base64,iVBORw0KGgoAAAANS"
        }
    ]
}

Значения статуса канала (state)
Значение 	Описание 	Виды транспорта
active 	Канал активен, все нормально 	Все
disabled 	Канал выключен. Такой статус возникает, когда канал не в подписке, а также во время технических работ 	Все
qr 	Необходимо отсканировать qr-код 	whatsapp и tgapi
phoneUnavailable 	Нет связи с телефоном. Устаревшее, но изредка может проявляться при проблемах в самом WhatsApp или на старых версиях приложения WhatsApp на телефоне 	whatsapp
openElsewhere 	WhatsApp Web открыли в другом месте 	whatsapp
notEnoughMoney 	Канал не оплачен 	Все
unauthorized 	Не авторизован — надо заново авторизовать канал 	Все
Изменение статуса модерации шаблона WABA
Параметр 	Тип 	Описание
templateGuid 	String 	guid шаблона
name 	String 	Имя шаблона
status 	String 	Статус модерации шаблона
Пример

{
  templateStatus: {
    templateGuid:"8d255e5d-aefd-44dc-8131-c3ad6c3ab28c",      
    name: "Test",      
    status: approved    
} 
}

Значения статуса (status)
Значение 	Описание
APPROVED 	То же, что «Активен» в ЛК Wazzup. Шаблон одобрен Meta*, его можно использовать
PENDING 	То же, что «На модерации» в ЛК Wazzup. Meta* еще проверяет шаблон
REJECTED 	В ЛК Wazzup — «Отклонен». Шаблон не прошел модерацию Meta*
PAUSED 	В ЛК Wazzup — «Отклонен». На шаблон жаловались получатели, поэтому Meta* его снова проверяет
DISABLED 	В ЛК Wazzup — «Отклонен». Шаблон заблокировали после жалоб
