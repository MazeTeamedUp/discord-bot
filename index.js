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
let panelSent = false;
// 🔥 FIXED: active tickets tracking
const activeTickets = new Map(); // userId -> channelId
const ticketClaims = new Map(); // channelId -> userId
// NEW: Partnership question states (sequential questions)
const ticketQuestionStates = new Map(); // channelId -> { userId, step, questions, answers }
// NEW: Partnership ads saved in memory (userId -> ad) - only saved when they answer the ad question
const partnershipAds = new Map();
// Partnership questions (asked one by one inside the ticket)
const PARTNERSHIP_QUESTIONS = [
  "Are you the owner of this server?",
  "How many players do you have?",
  "Please send us your ad."
];
// ================= ANNOUNCEMENT =================
const ANNOUNCEMENT_MESSAGE = `🌐 **Server Information**
🖥️ IP: \`play.paragonsmp.fun\`
🛒 Store: https://paragonsmp.fun
🎮 Port: 25592` ;
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
  // 🔥 AUTO ANNOUNCEMENT EVERY 30 MINUTES HAS BEEN REMOVED (as you requested)
  // Only !ip !store !shop !port !info will trigger it now
});
// ================= MESSAGE CREATE (for !ip commands + sequential partnership questions) =================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase().trim();
  // 🔥 AUTO ANNOUNCEMENT ON !ip !store !shop !port !info
  if (["!ip", "!store", "!shop", "!port", "!info"].includes(content)) {
    await message.channel.send(ANNOUNCEMENT_MESSAGE).catch(() => {});
    return;
  }
  // 🔥 SEQUENTIAL QUESTIONS FOR PARTNERSHIP TICKETS
  if (!ticketQuestionStates.has(message.channel.id)) return;
  const state = ticketQuestionStates.get(message.channel.id);
  // Only the ticket owner can answer
  if (message.author.id !== state.userId) return;
  // Save the answer
  state.answers.push(message.content);
  const nextStep = state.step + 1;
  if (nextStep < state.questions.length) {
    // Send next question
    state.step = nextStep;
    await message.channel.send(`**Question ${nextStep + 1}:** ${state.questions[nextStep]}`);
  } else {
    // All questions answered - save the ad (the answer to "Please send us your ad.")
    const ad = state.answers[2]; // 3rd answer is always the ad
    partnershipAds.set(state.userId, ad);
    await message.channel.send(
      "✅ Thank you for answering all questions! Please ping one of our staff members once and wait."
    );
    ticketQuestionStates.delete(message.channel.id);
  }
});
// ================= GUILD MEMBER REMOVE (NEW - tracks partners who leave) =================
client.on("guildMemberRemove", async (member) => {
  // Only trigger if they had a saved ad AND still had the partner role when leaving
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
  // Send private DM to the user who left
  try {
    await member.user.send("You have left the server which means your ad will be taken down.");
  } catch (e) {}
  // Clean up memory
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
      // 🔥 SPECIAL HANDLING FOR PARTNERSHIP (no modal, direct ticket + sequential questions)
      if (type === "partnership") {
        const channel = await interaction.guild.channels.create({
          name: `🎫ticket-${user.username}`,
          type: ChannelType.GuildText,
          parent: TICKET_CATEGORY_ID,
          topic: `ticket-${user.id}|${type}`,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
          ]
        });
        activeTickets.set(user.id, channel.id);
        const embed = new EmbedBuilder()
          .setTitle(`🎫 Ticket - ${user.username} (Partnership)`)
          .setDescription("Partnership request - please answer the following questions below.")
          .setColor(0x00aaff);
        const claimBtn = new ButtonBuilder()
          .setCustomId("claim")
          .setLabel("📌 Claim")
          .setStyle(ButtonStyle.Primary);
        const closeBtn = new ButtonBuilder()
          .setCustomId("close")
          .setLabel("❌ Close & Transcript")
          .setStyle(ButtonStyle.Danger);
        await channel.send({
          content: `<@${user.id}>`,
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(claimBtn, closeBtn)]
        });
        // 🤝 PARTNERSHIP EMBEDS (same as before)
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🤝 Partnership")
              .setDescription("One way ping - lower server pings everyone")
              .setColor(0x00aaff)
          ]
        });
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔁 Two Way Ping")
              .setDescription("Both servers equal → both use @here")
              .setColor(0x00aaff)
          ]
        });
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("⚠️ Rules")
              .setDescription("Leaving = ad removed")
              .setColor(0xff0000)
          ]
        });
        // 🔥 Start sequential questions
        ticketQuestionStates.set(channel.id, {
          userId: user.id,
          step: 0,
          questions: PARTNERSHIP_QUESTIONS,
          answers: []
        });
        // Send first question immediately
        await channel.send(`**Question 1:** ${PARTNERSHIP_QUESTIONS[0]}`);
        return interaction.reply({ content: "🎫 Partnership ticket created! Please answer the questions in the ticket channel.", ephemeral: true });
      }
      // ========== NORMAL TICKETS (show modal) ==========
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
    // ========== CREATE NORMAL TICKET (MODAL SUBMIT) ==========
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal_")) {
      const user = interaction.user;
      const type = interaction.customId.replace("ticket_modal_", "");
      const channel = await interaction.guild.channels.create({
        name: `🎫ticket-${user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `ticket-${user.id}|${type}`,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
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
        .setCustomId("claim")
        .setLabel("📌 Claim")
        .setStyle(ButtonStyle.Primary);
      const closeBtn = new ButtonBuilder()
        .setCustomId("close")
        .setLabel("❌ Close & Transcript")
        .setStyle(ButtonStyle.Danger);
      await channel.send({
        content: `<@${user.id}>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(claimBtn, closeBtn)]
      });
      return interaction.reply({ content: "🎫 Ticket created!", ephemeral: true });
    }
    // ========== CLAIM ==========
    if (interaction.isButton() && interaction.customId === "claim") {
      if (!STAFF_ROLES.some(r =>
        interaction.member.roles.cache.some(x => x.name === r)
      )) return interaction.reply({ content: "❌ No permission", ephemeral: true });
      ticketClaims.set(interaction.channel.id, interaction.user.id);
      const unclaim = new ButtonBuilder()
        .setCustomId("unclaim")
        .setLabel("❌ Unclaim")
        .setStyle(ButtonStyle.Danger);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📌 Ticket Claimed")
            .setDescription(`👮 Handled by ${interaction.user}`)
            .setColor(0x00ff00)
        ],
        components: [new ActionRowBuilder().addComponents(unclaim)]
      });
    }
    // ========== UNCLAIM ==========
    if (interaction.isButton() && interaction.customId === "unclaim") {
      ticketClaims.delete(interaction.channel.id);
      const claim = new ButtonBuilder()
        .setCustomId("claim")
        .setLabel("📌 Claim")
        .setStyle(ButtonStyle.Primary);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📌 Ticket Unclaimed")
            .setDescription("This ticket is no longer claimed")
            .setColor(0xffa500)
        ],
        components: [new ActionRowBuilder().addComponents(claim)]
      });
    }
    // ========== CLOSE BUTTON → OPEN REASON MODAL ==========
    if (interaction.isButton() && interaction.customId === "close") {
      const modal = new ModalBuilder()
        .setCustomId("close_reason_modal")
        .setTitle("Close Ticket & Transcript");
      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason for closing (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }
    // ========== CLOSE REASON MODAL SUBMIT (FIXED + ALL NEW REQUESTS) ==========
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
      if (!messages) {
        return interaction.editReply({ content: "❌ Failed to fetch messages." });
      }
      const sorted = [...messages.values()].reverse();
      const log = sorted.map(m =>
        `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || "(embed/attachment)"}`
      ).join("\n");
      const file = `ticket-${channel.id}.txt`;
      fs.writeFileSync(file, log || "No messages");
      const transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID);
      if (transcriptChannel) {
        const embed = new EmbedBuilder()
          .setTitle("🎫 Ticket Closed")
          .setColor(0xff0000)
          .addFields(
            { name: "👤 Created by", value: `<@${userId}>`, inline: true },
            { name: "👮 Closed by", value: `${interaction.user.tag}`, inline: true },
            { name: "📌 Reason", value: reason, inline: false },
            { name: "📂 Category", value: type, inline: false }
          )
          .setFooter({ text: "Ticket System" });
        await transcriptChannel.send({
          embeds: [embed],
          files: [file]
        });
      }
      // 🔥 Send transcript privately to the ticket opener (ONLY his ticket)
      if (userId) {
        try {
          const opener = await client.users.fetch(userId);
          const dmEmbed = new EmbedBuilder()
            .setTitle("🎫 Your Ticket Transcript")
            .setDescription(`Your ticket has been closed.\n**Reason:** ${reason}\n**Category:** ${type}`)
            .setColor(0xff0000);
          await opener.send({
            embeds: [dmEmbed],
            files: [file]
          });
        } catch (dmErr) {
          console.error("Failed to DM transcript:", dmErr);
        }
      }
      // Cleanup
      if (userId) activeTickets.delete(userId);
      ticketClaims.delete(channel.id);
      if (ticketQuestionStates.has(channel.id)) ticketQuestionStates.delete(channel.id);
      await interaction.editReply({ content: "🔒 Ticket closed and transcript saved!" });
      setTimeout(() => channel.delete().catch(() => {}), 2500);
      return;
    }
    // ========== MEMBER COUNT ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "member-count") {
      return interaction.reply(`👥 Members: ${interaction.guild.memberCount}`);
    }
    // ========== /P-ACCEPT (NEW) ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "p-accept") {
      if (!STAFF_ROLES.some(r =>
        interaction.member.roles.cache.some(x => x.name === r)
      )) {
        return interaction.reply({ content: "❌ No permission", ephemeral: true });
      }
      const channel = interaction.channel;
      if (!channel || !channel.topic || !channel.topic.includes("|partnership")) {
        return interaction.reply({ content: "❌ This command can only be used inside a partnership ticket.", ephemeral: true });
      }
      const userId = channel.topic.split("|")[0]?.replace("ticket-", "");
      if (!userId) return interaction.reply({ content: "❌ Could not find ticket owner.", ephemeral: true });
      const role = interaction.guild.roles.cache.get(PARTNERSHIP_ROLE_ID);
      if (!role) return interaction.reply({ content: "❌ Partnership role not found.", ephemeral: true });
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        await member.roles.add(role).catch(() => {});
      }
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Partnership Accepted")
            .setDescription(`Partnership has been accepted!\n<@${userId}> has received the partnership role.`)
            .setColor(0x00ff00)
        ]
      });
    }
  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ An error occurred while processing your request.", ephemeral: true }).catch(() => {});
    }
  }
});
// ================= LOGIN =================
client.login(process.env.TOKEN);
