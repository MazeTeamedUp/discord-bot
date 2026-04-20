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

let panelSent = false;

// 🔥 FIXED: active tickets tracking
const activeTickets = new Map(); // userId -> channelId
const ticketClaims = new Map();  // channelId -> userId

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

  setInterval(sendAnnouncement, 30 * 60 * 1000);
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {

  try {

    // ========== OPEN TICKET ==========
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_menu") {

      const user = interaction.user;

      if (activeTickets.has(user.id)) {
        return interaction.reply({ content: "❌ You already have a ticket.", ephemeral: true });
      }

      const type = interaction.values[0];

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

    // ========== CREATE TICKET ==========
    if (interaction.isModalSubmit()) {

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

      // 🤝 PARTNERSHIP EMBEDS
      if (type === "partnership") {

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
      }

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

    // ========== CLOSE + FIXED BUG ==========
    if (interaction.isButton() && interaction.customId === "close") {

      const channel = interaction.channel;

      if (!channel || !channel.topic || !channel.topic.includes("ticket-")) {
        return interaction.reply({ content: "❌ This is not a ticket.", ephemeral: true });
      }

      await interaction.reply({ content: "🔒 Closing ticket...", ephemeral: false });

      const userId = channel.topic.split("|")[0]?.replace("ticket-", "");

      const messages = await channel.messages.fetch().catch(() => null);
      if (!messages) return;

      const sorted = [...messages.values()].reverse();

      const log = sorted.map(m =>
        `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`
      ).join("\n");

      const file = `ticket-${channel.id}.txt`;
      fs.writeFileSync(file, log || "No messages");

      const transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID);

      // ✅ THIS IS YOUR FIXED TRANSCRIPT EMBED
      if (transcriptChannel) {

        const embed = new EmbedBuilder()
          .setTitle("🎫 Ticket Closed")
          .setColor(0xff0000)
          .addFields(
            { name: "👤 Created by", value: `<@${userId}>`, inline: true },
            { name: "👮 Closed by", value: `${interaction.user.tag}`, inline: true },
            { name: "📌 Channel", value: `${channel.name}`, inline: false },
            { name: "⏰ Time", value: new Date().toLocaleString(), inline: false }
          )
          .setFooter({ text: "Ticket System" });

        await transcriptChannel.send({
          embeds: [embed],
          files: [file]
        });
      }

      // 🔥 FIX: remove active ticket properly
      if (userId) activeTickets.delete(userId);

      setTimeout(() => channel.delete().catch(() => {}), 2500);
    }

    // ========== MEMBER COUNT ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "member-count") {
      return interaction.reply(`👥 Members: ${interaction.guild.memberCount}`);
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
