---
title: "GroupMe Bots Tutorial"
source: "https://dev.groupme.com/tutorials/bots"
---

## Bots Tutorial

![](https://dev.groupme.com/assets/bot_demo-5f33b7949be4572c350c7072be3f8a5a926319cf44b8087596a1ccba267cce54.png)

A bot is an automated group member that can be told to post messages to one of your groups with an HTTP POST request. Bots can also respond to messages sent by members of the group. Note: bots can only send messages to the app via push. They cannot send SMS messages to users in SMS-mode.

Using a bot is as easy as registering a member name and optional avatar url. Then you use the secret key you get back to post messages from your bot into your group.

## How to create a bot

## Method 1: using our form.

### Use our form

The easy (and most error-free) way to get a bot up and running is to use our [form for creating bots.](https://dev.groupme.com/bots/new)

## Method 2: using our API.

Here we'll show you the programmatic way to make a bot.

### 1\. Get your access token.

For the sake of convenience, your access token is listed at the top of the [bots page](https://dev.groupme.com/bots)

For the rest of this tutorial, we'll assume your access token is **token123**

### 2\. Find the group ID for the group you want the bot in.

You can retrieve group ids from the API.

```bash
curl https://api.groupme.com/v3/groups?token=token123
```

Will return json that looks like this:

```json
{
  meta: {
    "code": 200
  }
  response: [
    {
      "id": "12345",
      "group_id": 2000,
      //...
    },
    //...
  ]
}
```

For the rest of this tutorial, we'll assume your group ID is **2000**

### 3\. Register your bot

So your access token is **token123** and the group ID is **2000**. You want to make a bot called **Johnny Five**. The way to create a bot is to send an HTTP POST request to **https://api.groupme.com/v3/bots?token=token123** with the following POST body:

```json
{
  "bot": {
    "name": "Johnny Five",
    "group_id": "2000"
  }
}
```

If you were using cURL, the command line would look like this:

```bash
curl -X POST -d '{"bot": { "name": "Johnny Five", "group_id": "2000"}}' -H 'Content-Type: application/json' https://api.groupme.com/v3/bots?token=token123
```

You should get back a response that looks like this:

```json
{
  "meta": {
    "code": 201
  },
  "response": {
    "bot": {
      "name": "Johnny Five",
      "bot_id": "j5abcdefg"
      //...
    }
  }
}
```

The bot id in this case is **j5abcdefg**. Save that somewhere.

### Optional arguments when creating bots

##### Callback URLs

You can optionally specify a callback URL for the bot to read new messages from the group. This callback URL will receive an HTTP POST request from us every time a message is published to that group.

Let's say you want messages to be sent via POST to **https://example.com/bot\_callback**

Your request would look like this:

```bash
curl -X POST -d '{"bot": { "name": "Johnny Five", "group_id": "2000", "callback_url": "https://example.com/bot_callback" }}' -H 'Content-Type: application/json' https://api.groupme.com/v3/bots?token=token123
```

##### Avatar URLs

You can also specify an avatar URL that will give your bot an appearance in the group. Your request would look like this:

```bash
curl -X POST -d '{"bot": { "name": "Johnny Five", "group_id": "2000", "avatar_url": "https://imagehost.com/avatar.jpg" }}' -H 'Content-Type: application/json' https://api.groupme.com/v3/bots?token=token123
```

## Next: make your bot do something

Still got that bot ID? Cool. You can now write an app that can post to the group and/or get pinged when new messages appear in the group. To post in the group, send an HTTP POST to https://api.groupme.com/v3/bots/post with the following POST body:

```json
{
  "bot_id": "j5abcdefg",
  "text": "Hello world"
}
```

For those of you playing along with cURL:

```bash
curl -X POST "https://api.groupme.com/v3/bots/post?bot_id=j5abcdefg&text=Hello+world"
```

OR

```bash
curl -X POST -d '{"bot_id": "j5abcdefg", "text": "Hello world"}' -H 'Content-Type: application/json' https://api.groupme.com/v3/bots/post
```

#### New: image and location attachments

We now allow the bot to upload images as well as locations in the form of latitude/longitude pairs.

##### Posting images

The POST body for attaching an image looks like this. Note that the url must be for an image hosted by our image service. To get your images on our image service, you need to first upload them to our image service. See the documentation on how:[Image Service Documentation](https://dev.groupme.com/docs/image_service)

```json
{
  "bot_id": "j5abcdefg",
  "text": "Hello world",
  "attachments": [
    {
      "type": "image",
      "url": "https://i/groupme.com/somethingsomething.large"
    }
  ]
}
```

##### Posting locations

Similarly, you can attach locations to your message

```json
{
  "bot_id": "j5abcdefg",
  "text": "Hello world",
  "attachments": [
    {
      "type": "location",
      "lng": "40.000",
      "lat": "70.000",
      "name": "GroupMe HQ"
    }
  ]
}
```

Protip: You can add multiple attachments to a single message. For example, an image and a location. But you can't add multiple attachments of the same kind.

### Callbacks

If you've registered a callback url with your bot, each message sent to the group by any member will be posted to that callback url. A sample of the data format that is POSTed back is a V3 message:

```json
{
  "attachments": [],
  "avatar_url": "https://i.groupme.com/123456789",
  "created_at": 1302623328,
  "group_id": "1234567890",
  "id": "1234567890",
  "name": "John",
  "sender_id": "12345",
  "sender_type": "user",
  "source_guid": "GUID",
  "system": false,
  "text": "Hello world ☃☃",
  "user_id": "1234567890"
}
```

## So, where should my bot run???

Your bot can be something as simple as a script that runs every few minutes, or as complicated as an application that parses the text of the group conversation. You'll need some kind of application environment, with your bot code sitting on top of it. For example, you could create an app on Heroku with Heroku Scheduler running, and have that app post to your group.

---

Questions? Check out our [GroupMe API Support Google Group](https://groups.google.com/forum/#!forum/groupme-api-support).
