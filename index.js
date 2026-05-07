const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const fs = require("fs");

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
const express = require("express");
const app = express();
app.get("/", (req, res) => {
  res.send("Bot is alive");
});
app.listen(3000, () => {
  console.log("Keep-alive server running");
});

// ================= CONFIG =================
const PANEL_CHANNEL_ID = "1411760024363204800";
const TICKET_CATEGORY_ID = "1456670139486572818";
const TRANSCRIPT_CHANNEL_ID = "1456670136491704414";
const CHAT_CHANNEL_NAME = "『💬』ᴄʜᴀᴛ";
const STAFF_ROLES = [
  "Overall",
  "Founder - Right hand man",
  "Creator",
  "Developer 🔨",
  "Staff Manager",
  "Admin",
  "Senior Moderator",
  "Mod",
  "Junior Moderator",
  "Helper",
  "Staff-ping"
];
const PARTNERSHIP_ROLE_ID = "1462436008372080745";
const PARTNER_LOG_CHANNEL_ID = "1457341004075106509";
const FORUM_CHANNEL_ID = "1501613748551548938"; // forum for accepted partnership posts

let panelSent = false;

// ================= STATE MAPS =================
const activeTickets = new Map();               // userId -> channelId
const ticketClaims = new Map();               // channelId -> userId
const ticketQuestionStates = new Map();       // channelId -> { userId, step, questions, answers, evidenceUrl, serverPhotoUrl }
const partnershipAds = new Map();             // userId -> ad (legacy)
const partnershipAppData = new Map();         // userId -> modal answers
const awaitingTagsSelection = new Map();      // channelId -> questionState (paused for tags menu)
const partnershipSubmissions = new Map();     // channelId -> { userId, serverName, ad, discordInvite, store, tags, memberCount, visibility, evidenceUrl, serverPhotoUrl }
const ticketAcceptanceStatus = new Map();     // channelId -> { accepted: boolean, reviewerId: string }
const userForumPostMap = new Map();           // userId -> forumPostId

// ================= PARTNERSHIP QUESTIONS =================
// Indices: 0=ad, 1=server name, 2=member count, 3=evidence (dynamic), 4=server photo, 5=visibility, 6=tags
const BASE_QUESTIONS = [
  "Please provide your full advertisement without any links and only use normal emojis!",
  "What is your server name?",
  "How many members do you have?",
  "", // placeholder for dynamic evidence question
  "Could you provide a photo of your server?",
  "Is your server public or private?",
  "Please choose your tags"
];

// ================= ANNOUNCEMENT =================
const ANNOUNCEMENT_MESSAGE = `🌐 **Server Information**
🖥️ IP: \`play.paragonsmp.fun\`
🛒 Store: https://paragonsmp.fun
🎮 Port: 25592`;

async function sendAnnouncement() {
  client.guilds.cache.forEach(guild => {
    const channel = guild.channels.cache.find(
      c => c.name === CHAT_CHANNEL_NAME && c.isTextBased()
    );
    if (!channel) return;
    channel.send(ANNOUNCEMENT_MESSAGE).catch(() => {});
  });
}

// ================= SLASH COMMANDS =================
const commands = [
  new SlashCommandBuilder().setName("member-count").setDescription("Show member count"),
  new SlashCommandBuilder().setName("p-accept").setDescription("Accept partnership in the current ticket"),
  new SlashCommandBuilder().setName("close").setDescription("Close ticket (inside ticket only)")
].map(c => c.toJSON());
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= PANEL =================
async function sendPanel(guild) {
  if (panelSent) return;
  const channel = guild.channels.cache.get(PANEL_CHANNEL_ID);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Ticket System")
    .setColor(0x2b2d31)
    .setDescription(`Before opening a ticket, please make sure you follow the rules below:
1️⃣ Provide Clear Proof
You must have solid and clear evidence before creating a ticket. Tickets without proper proof may be closed.
2️⃣ Respect Staff Members
Any form of abuse, harassment, or disrespect toward staff will result in your ticket being closed immediately, without further discussion.
3️⃣ No Unbans for Serious Violations
We do not issue unbans for cases involving death threats or doxxing under any circumstances.
Please make sure your ticket includes all necessary details to help us assist you as quickly as possible. Thank you for your cooperation.`);
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_menu")
    .setPlaceholder("Select ticket type")
    .addOptions(
      { label: "🎟 Appeals", value: "appeals" },
      { label: "🤝 Partnership", value: "partnership" },
      { label: "💰 Payments", value: "payments" },
      { label: "🎧 Support", value: "support" },
      { label: "🚨 Report Player", value: "report" }
    );
  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  });
  panelSent = true;
}

// ================= READY =================
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guild.id),
      { body: commands }
    );
    sendPanel(guild);
  }
});

// ================= MESSAGE CREATE =================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase().trim();

  // Manual info commands
  if (["!ip", "!store", "!shop", "!port", "!info"].includes(content)) {
    await message.channel.send(ANNOUNCEMENT_MESSAGE).catch(() => {});
    return;
  }

  // Sequential questions for partnership tickets
  if (!ticketQuestionStates.has(message.channel.id)) return;
  const state = ticketQuestionStates.get(message.channel.id);
  if (message.author.id !== state.userId) return;

  // Save answer and handle attachment capture based on step
  const step = state.step;
  if (step === 3) { // evidence question: capture attachment
    if (message.attachments.size > 0) {
      state.evidenceUrl = message.attachments.first().url;
    }
    state.answers.push(message.content);
  } else if (step === 4) { // server photo question: capture attachment
    if (message.attachments.size > 0) {
      state.serverPhotoUrl = message.attachments.first().url;
    }
    state.answers.push(message.content || "(no text)");
  } else {
    state.answers.push(message.content);
  }

  // Move to next step
  let nextStep = step + 1;

  // Special handling after member count answer: build dynamic evidence question
  if (step === 2) {
    // Parse member count and compare with our server
    const theirMembers = parseInt(message.content, 10);
    const ourMembers = message.guild.memberCount;
    let pingReq;
    if (ourMembers - theirMembers >= 100) {
      pingReq = "@everyone";
    } else if (Math.abs(ourMembers - theirMembers) <= 99) {
      pingReq = "@here";
    } else {
      pingReq = "no ping";
    }

    const dynamicQ = `Please send our AD with the correct ping (${pingReq}) and attach a FULL screenshot of evidence that you sent our AD.
**Our Advertisement:**
\`\`\`
# 🌍 PARGON SMP 🌍
## ✨ An Up-and-Coming Survival Multiplayer Experience! ✨

Looking for a fresh SMP to call home? Pargon SMP is opening its doors and welcoming new players!

🔥 What We Offer:
• Survival Multiplayer (SMP) gameplay
• Friendly & active community
• Fair rules & chill moderation
• Events, builds, and long-term progression
• Supports TLauncher ✅

🛠️ Whether you're a builder, explorer, redstone genius, or just here to vibe, Pargon SMP is the place to grow, grind, and have fun together.

🚀 Join early. Build your legacy.
https://discord.gg/5pkSFeGzsv
[Paragon advertise video](https://www.youtube.com/shorts/tUPSwF3Ymxw)
|| Ping ||
\`\`\`
**Make sure to include the correct ping (${pingReq}) in the screenshot.**`;

    state.questions[3] = dynamicQ; // update the placeholder
    // Now fall through to send the next question
  }

  // After tags question (step 6) we show the summary; after step 6 is done, we call summary
  if (nextStep < BASE_QUESTIONS.length) {
    if (nextStep === 6) { // tags is menu, handled separately
      await sendTagsMenu(message.channel, state);
      return;
    }
    state.step = nextStep;
    await message.channel.send(`**Question ${nextStep + 1}:** ${state.questions[nextStep]}`);
  } else {
    // All answers collected
    await showSubmissionSummary(message.channel, state);
    ticketQuestionStates.delete(message.channel.id);
  }
});

async function sendTagsMenu(channel, state) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("partnership_tags")
    .setPlaceholder("Select your tags (multiple allowed)")
    .setMinValues(1)
    .setMaxValues(10)
    .addOptions([
      { label: "Written Applications", value: "written_applications" },
      { label: "Video Applications", value: "video_applications" },
      { label: "NA", value: "na" },
      { label: "EU", value: "eu" },
      { label: "AS", value: "as" },
      { label: "All Regions", value: "all_regions" },
      { label: "Vanilla", value: "vanilla" },
      { label: "Java", value: "java" },
      { label: "Bedrock", value: "bedrock" },
      { label: "Cracked", value: "cracked" }
    ]);
  await channel.send({
    content: "**Question 7:** Please choose your tags",
    components: [new ActionRowBuilder().addComponents(menu)]
  });
  awaitingTagsSelection.set(channel.id, state);
  ticketQuestionStates.delete(channel.id);
}

async function showSubmissionSummary(channel, state) {
  const {
    userId,
    answers,
    evidenceUrl,
    serverPhotoUrl
  } = state;
  // answers[0]=ad, [1]=serverName, [2]=memberCount, [3]=evidenceText, [4]=photoAnswer, [5]=visibility, [6]=tags
  const ad = answers[0];
  const serverName = answers[1];
  const memberCount = answers[2];
  const evidenceText = answers[3] || "";
  const visibility = answers[5];
  const tags = answers[6] || "Not selected";

  const modalData = partnershipAppData.get(userId) || {};
  const ownership = modalData.ownership || "Unknown";
  const prevPartner = modalData.prevPartner || "Unknown";
  const store = modalData.store === "None" ? "None" : modalData.store || "None";
  const discordInvite = modalData.invite || "Unknown";

  // Create main embed with basic info
  const mainEmbed = new EmbedBuilder()
    .setTitle("Complete Partnership Submission")
    .setColor(0x2b2d31)
    .addFields(
      { name: "Applicant", value: `<@${userId}>`, inline: true },
      { name: "Server Name", value: serverName, inline: true },
      { name: "Ownership", value: ownership, inline: true },
      { name: "Previous Partner", value: prevPartner, inline: true },
      { name: "Store", value: store, inline: true },
      { name: "Discord Invite", value: discordInvite, inline: true },
      { name: "Visibility", value: visibility, inline: true },
      { name: "Tags", value: tags, inline: false },
      { name: "Members", value: memberCount, inline: true }
    );

  // Create ad embed with the advertisement in a separate message
  const adEmbed = new EmbedBuilder()
    .setTitle("📢 Advertisement")
    .setColor(0x00aaff)
    .setDescription(ad || "Not provided");

  // Create server logo embed
  const serverLogoEmbed = new EmbedBuilder()
    .setTitle("🖼️ Server Logo")
    .setColor(0x00aaff)
    .setImage(serverPhotoUrl || null)
    .setFooter({ text: serverPhotoUrl ? "" : "No server logo provided" });

  // Create evidence embed
  const evidenceEmbed = new EmbedBuilder()
    .setTitle("📎 Evidence Screenshot")
    .setColor(0x00aaff)
    .setImage(evidenceUrl || null)
    .setFooter({ text: evidenceUrl ? "" : "No evidence provided" });

  const acceptBtn = new ButtonBuilder()
    .setCustomId("p_accept")
    .setLabel("Accept")
    .setStyle(ButtonStyle.Success);
  const denyBtn = new ButtonBuilder()
    .setCustomId("p_deny")
    .setLabel("Deny")
    .setStyle(ButtonStyle.Danger);

  // Send all embeds as separate messages for better visibility
  await channel.send({ embeds: [mainEmbed] });
  await channel.send({ embeds: [serverLogoEmbed] });
  await channel.send({ embeds: [adEmbed] });
  await channel.send({ embeds: [evidenceEmbed] });
  
  // Send action buttons
  const actionMsg = await channel.send({
    content: "**Use the buttons below to accept or deny this partnership:**",
    components: [new ActionRowBuilder().addComponents(acceptBtn, denyBtn)]
  });

  partnershipSubmissions.set(channel.id, {
    userId,
    serverName,
    ad,
    discordInvite,
    store,
    tags,
    memberCount,
    visibility,
    evidenceUrl,
    serverPhotoUrl,
    messageId: actionMsg.id
  });
}

// ================= GUILD MEMBER REMOVE =================
client.on("guildMemberRemove", async (member) => {
  // Remove forum post if exists
  if (userForumPostMap.has(member.id)) {
    const postId = userForumPostMap.get(member.id);
    try {
      const forumChannel = await member.guild.channels.fetch(FORUM_CHANNEL_ID);
      if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
        const thread = await forumChannel.threads.fetch(postId);
        await thread.delete();
      }
    } catch (e) {
      console.error("Failed to delete forum post on leave:", e);
    }
    userForumPostMap.delete(member.id);
  }

  // Legacy ad removal
  if (!partnershipAds.has(member.id)) return;
  if (!member.roles.cache.has(PARTNERSHIP_ROLE_ID)) return;
  const ad = partnershipAds.get(member.id);
  const logChannel = member.guild.channels.cache.get(PARTNER_LOG_CHANNEL_ID);
  if (logChannel && logChannel.isTextBased()) {
    const leaveEmbed = new EmbedBuilder()
      .setDescription(`${member.user.tag} has left the server while having partner role`)
      .setColor(0xff0000);
    const adEmbed = new EmbedBuilder()
      .setDescription(`His ad is : ${ad}`)
      .setColor(0x00aaff);
    await logChannel.send({
      embeds: [leaveEmbed, adEmbed]
    }).catch(() => {});
  }
  try {
    await member.user.send("You have left the server which means your ad will be taken down.");
  } catch (e) {}
  partnershipAds.delete(member.id);
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  try {
    // ========== OPEN TICKET (SELECT MENU) ==========
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_menu") {
      const user = interaction.user;
      if (activeTickets.has(user.id)) {
        return interaction.reply({ content: "❌ You already have a ticket.", ephemeral: true });
      }
      const type = interaction.values[0];
      if (type === "partnership") {
        const modal = new ModalBuilder()
          .setCustomId("partnership_modal")
          .setTitle("Partnership Application");
        const ownershipInput = new TextInputBuilder()
          .setCustomId("ownership")
          .setLabel("Are you the owner of the server?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const prevPartnerInput = new TextInputBuilder()
          .setCustomId("prev_partner")
          .setLabel("Have you partnered with us before?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const storeInput = new TextInputBuilder()
          .setCustomId("store")
          .setLabel("Store link (or type None)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const inviteInput = new TextInputBuilder()
          .setCustomId("invite")
          .setLabel("Discord Invite (25+ members)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(ownershipInput),
          new ActionRowBuilder().addComponents(prevPartnerInput),
          new ActionRowBuilder().addComponents(storeInput),
          new ActionRowBuilder().addComponents(inviteInput)
        );
        return interaction.showModal(modal);
      }
      // Normal tickets
      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${type}`)
        .setTitle("Ticket Setup");
      const ign = new TextInputBuilder().setCustomId("ign").setLabel("IGN?").setStyle(TextInputStyle.Short);
      const problem = new TextInputBuilder().setCustomId("problem").setLabel("Problem?").setStyle(TextInputStyle.Paragraph);
      const extra = new TextInputBuilder().setCustomId("extra").setLabel("Extra?").setStyle(TextInputStyle.Paragraph);
      modal.addComponents(
        new ActionRowBuilder().addComponents(ign),
        new ActionRowBuilder().addComponents(problem),
        new ActionRowBuilder().addComponents(extra)
      );
      return interaction.showModal(modal);
    }

    // ========== PARTNERSHIP MODAL SUBMIT ==========
    if (interaction.isModalSubmit() && interaction.customId === "partnership_modal") {
      const user = interaction.user;
      const ownership = interaction.fields.getTextInputValue("ownership");
      const prevPartner = interaction.fields.getTextInputValue("prev_partner");
      const store = interaction.fields.getTextInputValue("store");
      const invite = interaction.fields.getTextInputValue("invite");

      partnershipAppData.set(user.id, { ownership, prevPartner, store, invite });

      const channel = await interaction.guild.channels.create({
        name: `🎫ticket-${user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `ticket-${user.id}|partnership`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });
      activeTickets.set(user.id, channel.id);

      // Application info embed
      const infoEmbed = new EmbedBuilder()
        .setTitle("Partnership Application Info")
        .setColor(0x2b2d31)
        .addFields(
          { name: "Applicant", value: `<@${user.id}>`, inline: true },
          { name: "Ownership", value: ownership, inline: true },
          { name: "Previous Partner", value: prevPartner, inline: true },
          { name: "Store", value: store, inline: true },
          { name: "Discord Invite", value: invite, inline: false }
        );

      const claimBtn = new ButtonBuilder()
        .setCustomId("claim").setLabel("📌 Claim").setStyle(ButtonStyle.Primary);
      const closeBtn = new ButtonBuilder()
        .setCustomId("close").setLabel("❌ Close & Transcript").setStyle(ButtonStyle.Danger);

      await channel.send({
        content: `<@${user.id}>`,
        embeds: [infoEmbed],
        components: [new ActionRowBuilder().addComponents(claimBtn, closeBtn)]
      });

      // Initialize question state with a copy of BASE_QUESTIONS (placeholders will be updated dynamically)
      const questions = [...BASE_QUESTIONS];
      ticketQuestionStates.set(channel.id, {
        userId: user.id,
        step: 0,
        questions,
        answers: [],
        evidenceUrl: null,
        serverPhotoUrl: null
      });

      await channel.send(`**Question 1:** ${questions[0]}`);
      return interaction.reply({ content: "🎫 Partnership ticket created! Please answer the questions.", ephemeral: true });
    }

    // ========== NORMAL TICKET MODAL SUBMIT ==========
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal_")) {
      const user = interaction.user;
      const type = interaction.customId.replace("ticket_modal_", "");
      const channel = await interaction.guild.channels.create({
        name: `🎫ticket-${user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `ticket-${user.id}|${type}`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });
      activeTickets.set(user.id, channel.id);
      const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket - ${user.username}`)
        .setDescription(
`IGN: ${interaction.fields.getTextInputValue("ign")}
Problem: ${interaction.fields.getTextInputValue("problem")}
Extra: ${interaction.fields.getTextInputValue("extra")}
Type: ${type}`
        )
        .setColor(0x00aaff);
      const claimBtn = new ButtonBuilder()
        .setCustomId("claim").setLabel("📌 Claim").setStyle(ButtonStyle.Primary);
      const closeBtn = new ButtonBuilder()
        .setCustomId("close").setLabel("❌ Close & Transcript").setStyle(ButtonStyle.Danger);
      await channel.send({
        content: `<@${user.id}>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(claimBtn, closeBtn)]
      });
      return interaction.reply({ content: "🎫 Ticket created!", ephemeral: true });
    }

    // ========== TAGS MENU SELECTION ==========
    if (interaction.isStringSelectMenu() && interaction.customId === "partnership_tags") {
      if (!awaitingTagsSelection.has(interaction.channel.id)) {
        return interaction.reply({ content: "No active tag selection.", ephemeral: true });
      }
      const state = awaitingTagsSelection.get(interaction.channel.id);
      const selected = interaction.values;
      const tagsString = selected.join(", ");
      state.answers.push(tagsString);
      state.step = 6; // tags question completed
      await interaction.update({ content: `✅ Tags selected: ${tagsString}`, components: [] });
      await showSubmissionSummary(interaction.channel, state);
      awaitingTagsSelection.delete(interaction.channel.id);
      ticketQuestionStates.delete(interaction.channel.id);
      return;
    }

    // ========== CLAIM / UNCLAIM / CLOSE (same as before) ==========
    if (interaction.isButton() && interaction.customId === "claim") {
      if (!STAFF_ROLES.some(r => interaction.member.roles.cache.some(x => x.name === r)))
        return interaction.reply({ content: "❌ No permission", ephemeral: true });
      ticketClaims.set(interaction.channel.id, interaction.user.id);
      const unclaim = new ButtonBuilder().setCustomId("unclaim").setLabel("❌ Unclaim").setStyle(ButtonStyle.Danger);
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("📌 Ticket Claimed").setDescription(`👮 Handled by ${interaction.user}`).setColor(0x00ff00)],
        components: [new ActionRowBuilder().addComponents(unclaim)]
      });
    }
    if (interaction.isButton() && interaction.customId === "unclaim") {
      ticketClaims.delete(interaction.channel.id);
      const claim = new ButtonBuilder().setCustomId("claim").setLabel("📌 Claim").setStyle(ButtonStyle.Primary);
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("📌 Ticket Unclaimed").setDescription("This ticket is no longer claimed").setColor(0xffa500)],
        components: [new ActionRowBuilder().addComponents(claim)]
      });
    }
    if (interaction.isButton() && interaction.customId === "close") {
      const modal = new ModalBuilder()
        .setCustomId("close_reason_modal")
        .setTitle("Close Ticket & Transcript");
      const reasonInput = new TextInputBuilder()
        .setCustomId("reason").setLabel("Reason for closing (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId === "close_reason_modal") {
      await interaction.deferReply({ ephemeral: false });
      const reason = interaction.fields.getTextInputValue("reason")?.trim() || "No reason specified";
      const channel = interaction.channel;
      if (!channel || !channel.topic || !channel.topic.includes("ticket-")) {
        return interaction.editReply({ content: "❌ This is not a ticket." });
      }
      const parts = channel.topic.split("|");
      const userId = parts[0]?.replace("ticket-", "");
      const type = parts[1] || "unknown";
      const messages = await channel.messages.fetch().catch(() => null);
      if (!messages) return interaction.editReply({ content: "❌ Failed to fetch messages." });
      const sorted = [...messages.values()].reverse();
      const log = sorted.map(m =>
        `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || "(embed/attachment)"}`
      ).join("\n");
      const file = `ticket-${channel.id}.txt`;
      fs.writeFileSync(file, log || "No messages");

      const transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle("🎫 Ticket Closed")
        .setColor(0xff0000)
        .addFields(
          { name: "👤 Created by", value: `<@${userId}>`, inline: true },
          { name: "👮 Closed by", value: `${interaction.user.tag}`, inline: true },
          { name: "📌 Reason", value: reason, inline: false },
          { name: "📂 Category", value: type, inline: false }
        );
      const status = ticketAcceptanceStatus.get(channel.id);
      if (type === "partnership" && status) {
        embed.addFields({
          name: "🤝 Partnership Status",
          value: status.accepted ? `Accepted by <@${status.reviewerId}>` : "Denied",
          inline: false
        });
      }
      embed.setFooter({ text: "Ticket System" });
      if (transcriptChannel) await transcriptChannel.send({ embeds: [embed], files: [file] });

      if (userId) {
        try {
          const opener = await client.users.fetch(userId);
          const dmEmbed = new EmbedBuilder()
            .setTitle("🎫 Your Ticket Transcript")
            .setDescription(`Your ticket has been closed.\n**Reason:** ${reason}\n**Category:** ${type}`)
            .setColor(0xff0000);
          await opener.send({ embeds: [dmEmbed], files: [file] });
        } catch (dmErr) { console.error("Failed to DM transcript:", dmErr); }
      }

      if (userId) activeTickets.delete(userId);
      ticketClaims.delete(channel.id);
      ticketQuestionStates.delete(channel.id);
      partnershipSubmissions.delete(channel.id);
      ticketAcceptanceStatus.delete(channel.id);
      await interaction.editReply({ content: "🔒 Ticket closed and transcript saved!" });
      setTimeout(() => channel.delete().catch(() => {}), 2500);
      return;
    }

    // ========== MEMBER COUNT ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "member-count") {
      return interaction.reply(`👥 Members: ${interaction.guild.memberCount}`);
    }

    // ========== /P-ACCEPT (legacy) ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "p-accept") {
      if (!STAFF_ROLES.some(r => interaction.member.roles.cache.some(x => x.name === r)))
        return interaction.reply({ content: "❌ No permission", ephemeral: true });
      const channel = interaction.channel;
      if (!channel || !channel.topic || !channel.topic.includes("|partnership"))
        return interaction.reply({ content: "❌ Not a partnership ticket.", ephemeral: true });
      const userId = channel.topic.split("|")[0]?.replace("ticket-", "");
      const role = interaction.guild.roles.cache.get(PARTNERSHIP_ROLE_ID);
      if (!role) return interaction.reply({ content: "❌ Partnership role not found.", ephemeral: true });
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) await member.roles.add(role).catch(() => {});
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("✅ Partnership Accepted").setDescription(`<@${userId}> received the partnership role.`).setColor(0x00ff00)]
      });
    }

    // ========== PARTNERSHIP ACCEPT / DENY BUTTONS ==========
    if (interaction.isButton() && (interaction.customId === "p_accept" || interaction.customId === "p_deny")) {
      if (!STAFF_ROLES.some(r => interaction.member.roles.cache.some(x => x.name === r))) {
        return interaction.reply({ content: "❌ You must be staff+ to use this button.", ephemeral: true });
      }
      const submission = partnershipSubmissions.get(interaction.channel.id);
      if (!submission) return interaction.reply({ content: "❌ Submission not found.", ephemeral: true });

      const isAccept = interaction.customId === "p_accept";
      const { userId, serverName, ad, discordInvite, store, tags, evidenceUrl } = submission;
      const reviewer = interaction.user;

      if (isAccept) {
        // Grant role
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.add(PARTNERSHIP_ROLE_ID).catch(() => {});

        // Create forum post with multiple messages
        try {
          const forumChannel = await interaction.guild.channels.fetch(FORUM_CHANNEL_ID);
          if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
            const tagNames = tags.split(",").map(t => t.trim().toLowerCase());
            const matchingTags = forumChannel.availableTags.filter(t => tagNames.includes(t.name.toLowerCase()));
            const tagIds = matchingTags.map(t => t.id);

            const post = await forumChannel.threads.create({
              name: serverName,
              message: { content: "📷 **Evidence Screenshot**" }, // placeholder, we'll edit or send more
              appliedTags: tagIds
            });

            // Send evidence image first
            if (evidenceUrl) {
              await post.send({ embeds: [new EmbedBuilder().setImage(evidenceUrl)] });
            } else {
              await post.send("No evidence provided.");
            }
            // Send ad
            await post.send(`**📢 Advertisement**\n${ad}`);
            // Discord invite
            await post.send(`**🔗 Discord Invite**\n${discordInvite}`);
            // Store
            if (store !== "None") {
              await post.send(`**🛒 Store**\n${store}`);
            }

            // Delete the placeholder
            const starterMsg = await post.fetchStarterMessage().catch(() => null);
            if (starterMsg) await starterMsg.delete().catch(() => {});

            userForumPostMap.set(userId, post.id);
          }
        } catch (err) {
          console.error("Failed to create forum post:", err);
        }

        // DM applicant
        try {
          const user = await client.users.fetch(userId);
          const dmEmbed = new EmbedBuilder()
            .setTitle("Partnership Application Accepted!")
            .setDescription(`Congratulations! Your partnership application has been accepted!`)
            .addFields(
              { name: "Server Name", value: serverName },
              { name: "Reviewed By", value: `${reviewer.tag} (<@${reviewer.id}>)` }
            )
            .setFooter({ text: "Paragon SMP Staff Team" })
            .setTimestamp()
            .setColor(0x00ff00);
          await user.send({ embeds: [dmEmbed] });
        } catch (dmErr) {
          console.error("Failed to DM applicant:", dmErr);
        }

        ticketAcceptanceStatus.set(interaction.channel.id, { accepted: true, reviewerId: reviewer.id });

        await interaction.update({
          embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: "Accepted by " + reviewer.tag }).setColor(0x00ff00)],
          components: []
        });
      } else {
        // Deny
        try {
          const user = await client.users.fetch(userId);
          await user.send("Partnership denied. You can remove our ad.");
        } catch (dmErr) {
          console.error("Failed to DM applicant:", dmErr);
        }
        ticketAcceptanceStatus.set(interaction.channel.id, { accepted: false, reviewerId: reviewer.id });
        await interaction.update({
          embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: "Denied by " + reviewer.tag }).setColor(0xff0000)],
          components: []
        });
      }
      return;
    }

    // ========== /CLOSE ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "close") {
      return interaction.reply({ content: "Use the close button to provide a reason.", ephemeral: true });
    }
  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
    }
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN)
