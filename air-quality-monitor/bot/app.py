from flask import Flask, request, abort
import json
import base64

from linebot import (
    LineBotApi, WebhookParser
)
from linebot.exceptions import (
    InvalidSignatureError
)
from linebot.models import (
    MessageEvent, TextMessage, TextSendMessage,
)

app = Flask(__name__)

#ACCESS_TOKEN = "<YOUR_ACCESS_TOKEN>"
#CHANNEL_SECRET = "<YOUR_CHANNEL_SECRET>"
line_bot_api = "" #LineBotApi(ACCESS_TOKEN)
parser = "" #WebhookParser(CHANNEL_SECRET)

@app.route("/")
def healthcheck():
    return 'OK'

@app.route("/callback", methods=['POST'])
def callback():
    signature = request.headers['X-Line-Signature']

    # get request body as text
    body = request.get_data(as_text=True)
    app.logger.info("Request body: " + body)

    try:
        # Python SDK doesn't support LINE Things event
        # => Unknown event type. type=things
        for event in parser.parse(body, signature):
            handle_message(event)

        # Parse JSON without SDK for LINE Things event
        events = json.loads(body)
        for event in events["events"]:
            if "things" in event:
                handle_things_event(event)
    except InvalidSignatureError:
        print("Invalid signature. Please check your channel access token/channel secret.")
        abort(400)

    return 'OK'

def handle_things_event(event):
    if event["things"]["type"] != "scenarioResult":
        return
    if event["things"]["result"]["resultCode"] != "success":
        app.logger.warn("Error result: %s", event)
        return

    if "bleNotificationPayload" in event["things"]["result"]:
        button_state = base64.b64decode(event["things"]["result"]["bleNotificationPayload"])

        battery = button_state[1] * 256  + button_state[0]
        temperature = button_state[3] * 256  + button_state[2]
        humidity = button_state[5] * 256  + button_state[4]
        pressure = button_state[7] * 256  + button_state[6]
        co2 = button_state[9] * 256  + button_state[8]
        tvoc = button_state[11] * 256  + button_state[10]
        altitude = button_state[13] * 256  + button_state[12]

        message = "バッテリ残量 : " + str(battery) + "%\n"
        message += "温度 : " + str(temperature) + "度\n"
        message += "湿度 : " + str(humidity) + "%\n"
        message += "気圧 : " + str(pressure) + "hPa\n"
        message += "高度 : " + str(altitude) + "m\n"
        message += "CO2 : " + str(co2) + "ppm\n"
        message += "TVOC : " + str(tvoc) + "ppm\n"

        print(message)
        line_bot_api.reply_message(event["replyToken"], TextSendMessage(text=message))


def handle_message(event):
    if event.type == "message" and event.message.type == "text":
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text=event.message.text))

if __name__ == "__main__":
    f = open('config.json', 'r')
    json_dict = json.load(f)
    #print(json_dict['access_token'])
    #print(json_dict['channel_secret'])

    line_bot_api = LineBotApi(json_dict['access_token'])
    parser = WebhookParser(json_dict['channel_secret'])

    app.run(debug=True)
