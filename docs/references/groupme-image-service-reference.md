---
title: "GroupMe Image Service Reference"
source: "https://dev.groupme.com/docs/image_service"
---

## Image Service

```text
https://image.groupme.com
```

Images uploaded to image service will return a URL that looks like this:

```text
https://i.groupme.com/{width}x{height}.{format}.{id}
```

Where {width} and {height} are in pixels, {format} is for example "png" or "jpeg" and {id} is a unique id e.g.

```text
https://i.groupme.com/480x325.jpeg.9e20b71dd6af4b58bbd132d4a7dec009
```

## To try this out via cURL:

Store your access token in the GM_TOKEN environment variable first.

```bash
curl 'https://image.groupme.com/pictures' -X POST -H "X-Access-Token: $GM_TOKEN" -H "Content-Type: image/jpeg" --data-binary @AwesomePicture.jpg
```

## Thumbnails

Images are automatically thumbnailed at the following sizes:

| suffix  | size                                                  | example                                             |
| ------- | ----------------------------------------------------- | --------------------------------------------------- |
| preview | 200x200, centered and cropped                         | https://i.groupme.com/100x100.png.123456789.preview |
| large   | 960x960, preserve aspect ratio so largest side is 960 | https://i.groupme.com/100x100.png.123456789.large   |
| avatar  | 60x60, centered and cropped                           | https://i.groupme.com/100x100.png.123456789.avatar  |

## Pictures

### Pictures

Upload image data

We will process, store, and thumbnail it

#### Request

```text
"... binary image data..."
```

#### Parameters

access_token required

string

#### Responses

```json
{
  "payload": {
    "url": "https://i.groupme.com/123456789",
    "picture_url": "https://i.groupme.com/123456789"
  }
}
```

---

[Back to Top](https://dev.groupme.com/docs/#image_service)
