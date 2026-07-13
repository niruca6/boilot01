const { Client, GatewayIntentBits } = require("discord.js");
const token = process.env.DISCORD_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;
const { GoogleGenAI } = require('@google/genai');
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

let msg;
let lastMsg;

// Gemini APIの初期化
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

client.on("ready", () => {
  console.log(`${client.user.tag} でログインしています。`);
});

client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  // 1. ユーザーが !fb を送信したらスタート
  if (msg.content === "!fb") {
    try {
      await msg.channel.sendTyping(); // ボットが「入力中...」になる演出

      // 2. チャンネル内（またはスレッド内）から過去のメッセージを取得（最大100件）
      const fetchedMessages = await msg.channel.messages.fetch({ limit: 100 });
      
      const now = new Date();
      const twoHoursAgo = now.getTime() - (3 * 60 * 60 * 1000); // 3時間前のタイムスタンプ

      // 条件に合うメッセージをフィルタリング（Botを除外し、2時間以内、新しい順）
      const recentMessages = Array.from(fetchedMessages.values()).filter(m => {
        return !m.author.bot && m.createdAt.getTime() >= twoHoursAgo;
      });

      // 4. !fb を境に、前回の添削より「後(A)」と「前(B)」に分ける
      let messagesAfterFb = [];  // A: 今回の !fb より新しく投稿されたチャット（基本的には空か非常に少ない）
      let messagesBeforeFb = []; // B: 今回の !fb より前に投稿されたチャット（これがメイン）
      
      let passedCurrentFb = false;

      for (const m of recentMessages) {
        // 取得した中で、今回のトリガーとなった「!fb」自体を最初に見つけたとき
        if (m.id === msg.id) {
          passedCurrentFb = true;
          continue; // 「!fb」自体は会話に含めない
        }

        // フォーマットを作成 「@username: contents」
        const formattedMsg = `@${m.author.username}: ${m.content}`;

        if (!passedCurrentFb) {
          // 今回の !fb より「後」に投稿されたメッセージ（新しい）
          // 別のユーザーが!fbが処理される直前に書き込んだ場合など
          if (m.content !== "!fb") {
            messagesAfterFb.push(formattedMsg);
          }
        } else {
          // 今回の !fb より「前」に投稿されたメッセージ（古い）
          // 次の「!fb」が見つかったら、そこが「前回の添削」の境界線になる
          if (m.content === "!fb") {
            break; // 前回の!fbに到達したので、それより古いチャットは取得を終了
          }
          messagesBeforeFb.push(formattedMsg);
        }
      }

      // 5. 会話を「古い順」に並び替える（Discordからは新しい順で取れるため reverse() する）
      messagesAfterFb.reverse();
      messagesBeforeFb.reverse();

      // テキストの塊にする
      const textA = messagesAfterFb.join('\n') || "（なし）";
      const textB = messagesBeforeFb.join('\n') || "（なし）";

      if (textB === "（なし）" && textA === "（なし）") {
        return await msg.reply("No chat found!");
      }

      // 6. プロンプトを作成してAIに送信
      const prompt = `
You are an excellent native English teacher.
Please analyze the English chat history from Discord and provide corrections and advice to help make the expressions more natural.

[Guidelines]
- Identify the English chat messages within the conversation and give advice for any grammatical errors or ways to use more natural phrasing (such as slang or idioms).
- Provide clear, friendly explanations without using overly complex vocabulary.
- Every advice should be short and like real chat.
- There should be no greeting or introduction.
- Ignore any messages that are not in English or contain meaningless strings of characters.

[Formats of advice]
✅@sender: message requiring no corrections
your comment if need

🟨@sender: message requiring expression advice
your comment

🟥@sender: message with error
your comment

✨POINT
summary if need

[Text decoration formats]
**bold**
__underline__
> blockquote

[Chat for corrections]
${textB}

[Chat not for corrections (for context understanding)]
${textA}
`;

      // Gemini 3.5 Flash モデルを呼び出し
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
      });

      // 7. 応答を返信する（Discordの2000文字制限に配慮し、長ければ分割）
      const replyText = response.text;

      console.log("-----CATCHED FEEDBACK (Pprompt 5)-----");
      console.log(replyText);
      console.log("-----END FEEDBACK-----");

      if (replyText.length > 2000) {
        // 2000文字を超える場合は分割して送信
        const chunks = replyText.match(/[\s\S]{1,1900}/g);
        for (const chunk of chunks) {
          await msg.channel.send(chunk);
        }
      } else {
        await msg.reply(replyText);
      }

    } catch (error) {
      console.error("エラーが発生しました:", error);
      await msg.reply("An error occured. please try again!");
    }
  }
});

client.login(token);