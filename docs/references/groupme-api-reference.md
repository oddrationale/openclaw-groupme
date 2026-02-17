---
title: "GroupMe Public API Reference"
source: "https://dev.groupme.com/docs/v3"
---

## Public API

### API Responses

[How our API responses are structured](https://dev.groupme.com/docs/responses)

### Hitting our REST API

**Always include your token as a parameter when making requests.**

Base Url:

```text
https://api.groupme.com/v3
```

Example posting JSON data:

```bash
$ curl -X POST -H "Content-Type: application/json" -d '{"name": "Family"}' https://api.groupme.com/v3/groups?token=YOUR_ACCESS_TOKEN
```

Example JSON response envelope ("response" key omitted in Responses for brevity):

```http
HTTP/1.1 201

{
	"response": {
			"id": "12345",
			"name": "Family"
			//...
		}
	}
}
```

Example JSON errors envelope:

```http
HTTP/1.1 400

{
	meta: {
		"code": 400,
		"errors": ["Name is required"]
	},
	response: null
}
```

## Groups

### Index

List the authenticated user's active groups.

The response is paginated, with a default of 10 groups per page.

Please consider using of omit=memberships parameter. Not including member lists might significantly improve user experience of your app for users who are participating in huge groups.

#### Request

```http
GET /groups
```

#### Parameters

page

integer — Fetch a particular page of results. Defaults to 1.

per_page

integer — Define page size. Defaults to 10.

omit

string — Comma separated list of data to omit from output. Currently supported value is only "memberships". If used then response will contain empty (null) members field.

#### Responses

```json
[
  {
    "id": "1234567890",
    "name": "Family",
    "type": "private",
    "description": "Coolest Family Ever",
    "image_url": "https://i.groupme.com/123456789",
    "creator_user_id": "1234567890",
    "created_at": 1302623328,
    "updated_at": 1302623328,
    "members": [
      {
        "user_id": "1234567890",
        "nickname": "Jane",
        "muted": false,
        "image_url": "https://i.groupme.com/123456789"
      }
    ],
    "share_url": "https://groupme.com/join_group/1234567890/SHARE_TOKEN",
    "messages": {
      "count": 100,
      "last_message_id": "1234567890",
      "last_message_created_at": 1302623328,
      "preview": {
        "nickname": "Jane",
        "text": "Hello world",
        "image_url": "https://i.groupme.com/123456789",
        "attachments": [
          { "type": "image", "url": "https://i.groupme.com/123456789" },
          { "type": "image", "url": "https://i.groupme.com/123456789" },
          {
            "type": "location",
            "lat": "40.738206",
            "lng": "-73.993285",
            "name": "GroupMe HQ"
          },
          { "type": "split", "token": "SPLIT_TOKEN" },
          {
            "type": "emoji",
            "placeholder": "☃",
            "charmap": [
              [1, 42],
              [2, 34]
            ]
          }
        ]
      }
    }
  }
]
```

### Former

List they groups you have left but can rejoin.

#### Request

```http
GET /groups/former
```

#### Responses

```json
[
  {
    "id": "1234567890",
    "name": "Family",
    "type": "private",
    "description": "Coolest Family Ever",
    "image_url": "https://i.groupme.com/123456789",
    "creator_user_id": "1234567890",
    "created_at": 1302623328,
    "updated_at": 1302623328,
    "members": [
      {
        "user_id": "1234567890",
        "nickname": "Jane",
        "muted": false,
        "image_url": "https://i.groupme.com/123456789"
      }
    ],
    "share_url": "https://groupme.com/join_group/1234567890/SHARE_TOKEN",
    "messages": {
      "count": 100,
      "last_message_id": "1234567890",
      "last_message_created_at": 1302623328,
      "preview": {
        "nickname": "Jane",
        "text": "Hello world",
        "image_url": "https://i.groupme.com/123456789",
        "attachments": [
          { "type": "image", "url": "https://i.groupme.com/123456789" },
          { "type": "image", "url": "https://i.groupme.com/123456789" },
          {
            "type": "location",
            "lat": "40.738206",
            "lng": "-73.993285",
            "name": "GroupMe HQ"
          },
          { "type": "split", "token": "SPLIT_TOKEN" },
          {
            "type": "emoji",
            "placeholder": "☃",
            "charmap": [
              [1, 42],
              [2, 34]
            ]
          }
        ]
      }
    }
  }
]
```

### Show

Load a specific group.

#### Request

```http
GET /groups/:id
```

#### Parameters

id required

string

#### Responses

```json
{
  "id": "1234567890",
  "name": "Family",
  "type": "private",
  "description": "Coolest Family Ever",
  "image_url": "https://i.groupme.com/123456789",
  "creator_user_id": "1234567890",
  "created_at": 1302623328,
  "updated_at": 1302623328,
  "members": [
    {
      "user_id": "1234567890",
      "nickname": "Jane",
      "muted": false,
      "image_url": "https://i.groupme.com/123456789"
    }
  ],
  "share_url": "https://groupme.com/join_group/1234567890/SHARE_TOKEN",
  "messages": {
    "count": 100,
    "last_message_id": "1234567890",
    "last_message_created_at": 1302623328,
    "preview": {
      "nickname": "Jane",
      "text": "Hello world",
      "image_url": "https://i.groupme.com/123456789",
      "attachments": [
        { "type": "image", "url": "https://i.groupme.com/123456789" },
        { "type": "image", "url": "https://i.groupme.com/123456789" },
        {
          "type": "location",
          "lat": "40.738206",
          "lng": "-73.993285",
          "name": "GroupMe HQ"
        },
        { "type": "split", "token": "SPLIT_TOKEN" },
        {
          "type": "emoji",
          "placeholder": "☃",
          "charmap": [
            [1, 42],
            [2, 34]
          ]
        }
      ]
    }
  }
}
```

## Members

### Results

Get the membership results from an [add call](https://dev.groupme.com/docs/#members_add).

Successfully created memberships will be returned, including any GUIDs that were sent up in the add request. If GUIDs were absent, they are filled in automatically. Failed memberships and invites are omitted.

Keep in mind that results are **temporary** -- they will only be available for 1 hour after the add request.

#### Request

```http
GET /groups/:group_id/members/results/:results_id
```

#### Parameters

results_id required

string — This is the guid that's returned from an add request.

#### Responses

```json
{
  "members": [
    {
      "id": "1000",
      "user_id": "10000",
      "nickname": "John",
      "muted": false,
      "image_url": "https://i.groupme.com/AVATAR",
      "autokicked": false,
      "app_installed": true,
      "guid": "GUID-1"
    },
    {
      "id": "2000",
      "user_id": "20000",
      "nickname": "Anne",
      "muted": false,
      "image_url": "https://i.groupme.com/AVATAR",
      "autokicked": false,
      "app_installed": true,
      "guid": "GUID-2"
    }
  ]
}
```

### Remove

Remove a member (or yourself) from a group.

Note: The creator of the group cannot be removed or exit.

#### Request

```http
POST /groups/:group_id/members/:membership_id/remove
```

#### Parameters

membership_id required

string — Please note that this isn't the same as the user ID. In the `members` key in the group JSON, this is the `id` value, not the `user_id`.

#### Responses

```http
Status: 200 OK
```

### Update

Update your nickname in a group. The nickname must be between 1 and 50 characters.

#### Request

```json
{ "membership": { "nickname": "NEW NICKNAME" } }
```

#### Responses

```json
{
  "id": "MEMBERSHIP ID",
  "user_id": "USER ID",
  "nickname": "NEW NICKNAME",
  "muted": false,
  "image_url": "AVATAR URL",
  "autokicked": false,
  "app_installed": true
}
```

## Messages

### Index

Retrieve messages for a group.

By default, messages are returned in groups of 20, ordered by `created_at` descending. This can be raised or lowered by passing a `limit` parameter, up to a maximum of 100 messages.

Messages can be scanned by providing a message ID as either the `before_id`, `since_id`, or `after_id` parameter. If `before_id` is provided, then messages _immediately preceding_ the given message will be returned, in descending order. This can be used to continually page back through a group's messages.

The `after_id` parameter will return messages that _immediately follow_ a given message, this time in _ascending order_ (which makes it easy to pick off the last result for continued pagination).

Finally, the `since_id` parameter also returns messages created after the given message, but it retrieves the _most recent_ messages. For example, if more than twenty messages are created after the `since_id` message, using this parameter will omit the messages that immediately follow the given message. This is a bit counterintuitive, so take care.

If no messages are found (e.g. when filtering with `before_id`) we return code `304`.

Note that for historical reasons, likes are returned as an array of user ids in the `favorited_by` key.

#### Request

```http
GET /groups/:group_id/messages
```

#### Parameters

before_id

string — Returns messages created before the given message ID

since_id

string — Returns most recent messages created after the given message ID

after_id

string — Returns messages created immediately after the given message ID

limit

integer — Number of messages returned. Default is 20. Max is 100.

#### Responses

```json
{
  "count": 123,
  "messages": [
    {
      "id": "1234567890",
      "source_guid": "GUID",
      "created_at": 1302623328,
      "user_id": "1234567890",
      "group_id": "1234567890",
      "name": "John",
      "avatar_url": "https://i.groupme.com/123456789",
      "text": "Hello world ☃☃",
      "system": true,
      "favorited_by": ["101", "66", "1234567890"],
      "attachments": [
        { "type": "image", "url": "https://i.groupme.com/123456789" },
        { "type": "image", "url": "https://i.groupme.com/123456789" },
        {
          "type": "location",
          "lat": "40.738206",
          "lng": "-73.993285",
          "name": "GroupMe HQ"
        },
        { "type": "split", "token": "SPLIT_TOKEN" },
        {
          "type": "emoji",
          "placeholder": "☃",
          "charmap": [
            [1, 42],
            [2, 34]
          ]
        }
      ]
    }
  ]
}
```

### Create

Send a message to a group

If you want to attach an image, you must first process it through our [image service](https://dev.groupme.com/docs/image_service).

Attachments of type `emoji` rely on data from emoji PowerUps.

Clients use a `placeholder` character in the message `text` and specify a replacement `charmap` to substitute emoji characters

The character map is an array of arrays containing rune data (`[[{pack_id,offset}],...]`).

The `placeholder` should be a high-point/invisible UTF-8 character.

#### Request

```json
{
  "message": {
    "source_guid": "GUID",
    "text": "Hello world ☃☃",
    "attachments": [
      { "type": "image", "url": "https://i.groupme.com/123456789" },
      { "type": "image", "url": "https://i.groupme.com/123456789" },
      {
        "type": "location",
        "lat": "40.738206",
        "lng": "-73.993285",
        "name": "GroupMe HQ"
      },
      { "type": "split", "token": "SPLIT_TOKEN" },
      {
        "type": "emoji",
        "placeholder": "☃",
        "charmap": [
          [1, 42],
          [2, 34]
        ]
      }
    ]
  }
}
```

#### Parameters

source_guid required

string — Client-side IDs for messages. This can be used by clients to set their own identifiers on messages, but the server also scans these for de-duplication. That is, if two messages are sent with the same `source_guid` within one minute of each other, the second message will fail with a `409 Conflict` response. _So it's important to set this to a unique value for each message._

text required

string — This can be omitted if at least one `attachment` is present. The maximum length is **1,000** characters.

attachments

array — A polymorphic list of attachments (locations, images, etc). You may have You may have more than one of any type of attachment, provided clients can display it.

- **object**
  - **type** (string) — **“image”** required
  - **url** (string) required — Must be an image service (i.groupme.com) URL
- **object**
  - **type** (string) — **“location”** required
  - **name** (string) required
  - **lat** (string) required
  - **lng** (string) required
- **object**
  - **type** (string) — **“split”** required
  - **token** (string) required
- **object**
  - **type** (string) — **“emoji”** required
  - **placeholder** (string) — **“☃”** required
  - **charmap** (array) — **“\[{pack_id},{offset}\]”** required

#### Responses

```json
{
  "message": {
    "id": "1234567890",
    "source_guid": "GUID",
    "created_at": 1302623328,
    "user_id": "1234567890",
    "group_id": "1234567890",
    "name": "John",
    "avatar_url": "https://i.groupme.com/123456789",
    "text": "Hello world ☃☃",
    "system": true,
    "favorited_by": ["101", "66", "1234567890"],
    "attachments": [
      { "type": "image", "url": "https://i.groupme.com/123456789" },
      { "type": "image", "url": "https://i.groupme.com/123456789" },
      {
        "type": "location",
        "lat": "40.738206",
        "lng": "-73.993285",
        "name": "GroupMe HQ"
      },
      { "type": "split", "token": "SPLIT_TOKEN" },
      {
        "type": "emoji",
        "placeholder": "☃",
        "charmap": [
          [1, 42],
          [2, 34]
        ]
      }
    ]
  }
}
```

## Chats

### Index

Returns a paginated list of direct message chats, or conversations, sorted by `updated_at` descending.

#### Request

```http
GET /chats
```

#### Parameters

page

integer — Page number

per_page

integer — Number of chats per page

#### Responses

```json
[
  {
    "created_at": 1352299338,
    "updated_at": 1352299338,
    "last_message": {
      "attachments": [],
      "avatar_url": "https://i.groupme.com/200x200.jpeg.abcdef",
      "conversation_id": "12345+67890",
      "created_at": 1352299338,
      "favorited_by": [],
      "id": "1234567890",
      "name": "John Doe",
      "recipient_id": "67890",
      "sender_id": "12345",
      "sender_type": "user",
      "source_guid": "GUID",
      "text": "Hello world",
      "user_id": "12345"
    },
    "messages_count": 10,
    "other_user": {
      "avatar_url": "https://i.groupme.com/200x200.jpeg.abcdef",
      "id": 12345,
      "name": "John Doe"
    }
  }
]
```

## Likes

## Bots

### Create

Create a bot. See our [Bots Tutorial](https://dev.groupme.com/tutorials/bots) for a full walkthrough.

#### Request

```http
POST /bots
```

#### Parameters

bot\[name\] required

string

bot\[group_id\] required

string

bot\[avatar_url\]

string

bot\[callback_url\]

string

bot\[dm_notification\]

boolean

bot\[active\] required

boolean

#### Responses

```json
{
  "bot_id": "1234567890",
  "group_id": "1234567890",
  "name": "hal9000",
  "avatar_url": "https://i.groupme.com/123456789",
  "callback_url": "https://example.com/bots/callback",
  "dm_notification": false,
  "active": true
}
```

### Post a Message

Post a message from a bot

#### Request

```http
POST /bots/post
```

#### Parameters

bot_id required

string

text required

string

picture_url

string — Image must be processed through [image service](https://dev.groupme.com/docs/image_service).

#### Responses

```http
Status: 201 Created
```

### Index

List bots that you have created

#### Request

```http
GET /bots
```

#### Responses

```json
[
  {
    "bot_id": "1234567890",
    "group_id": "1234567890",
    "name": "hal9000",
    "avatar_url": "https://i.groupme.com/123456789",
    "callback_url": "https://example.com/bots/callback",
    "dm_notification": false,
    "active": true
  }
]
```

## Users

### Me

Get details about the authenticated user

#### Request

```http
GET /users/me
```

#### Responses

```json
{
  "id": "1234567890",
  "phone_number": "+1 2123001234",
  "image_url": "https://i.groupme.com/123456789",
  "name": "Ronald Swanson",
  "created_at": 1302623328,
  "updated_at": 1302623328,
  "email": "me@example.com",
  "sms": false
}
```

### Update

Update attributes about your own account

#### Request

```json
{
  "avatar_url": "https://4.bp.blogspot.com/-GAeMYT8SZoI/TtBTK209xMI/AAAAAAAAWts/5nmvpmmvoWo/s1600/TopGun_059Pyxurz.jpg",
  "name": "Tom Skerritt",
  "email": "viper@topgun.usaf.mil",
  "zip_code": "92145"
}
```

#### Parameters

avatar_url

string — URL to valid JPG/PNG/GIF image. URL will be converted into an image service link (https://i.groupme.com/....)

name

string — Name must be of the form FirstName LastName

email

string — Email address. Must be in name@domain.com form.

zip_code

string — Zip code.

#### Responses

```json
{
  "id": "1234567890",
  "phone_number": "+1 2123001234",
  "image_url": "https://i.groupme.com/123456789",
  "name": "Ronald Swanson",
  "created_at": 1302623328,
  "updated_at": 1302623328,
  "email": "me@example.com",
  "sms": false
}
```

## Blocks

### Index

A list of contacts you have blocked. These people cannot DM you.

#### Request

```http
GET /blocks?user=<your user id>
```

#### Responses

```json
{
  "blocks": [
    {
      "user_id": "1234567890",
      "blocked_user_id": "1234567890",
      "created_at": 1302623328
    }
  ]
}
```

### Create Block

Creates a block between you and the contact

#### Request

```http
POST /blocks?user=<you>&otherUser=<other user>
```

#### Parameters

user required

string — your user id.

otherUser required

string — user id of person you want to block.

#### Responses

```json
{
  "block": {
    "user_id": "1234567890",
    "blocked_user_id": "1234567890",
    "created_at": 1302623328
  }
}
```

### Unblock

---

[Back to Top](https://dev.groupme.com/docs/#v3)
