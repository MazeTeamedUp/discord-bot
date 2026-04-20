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

let panelSent = false;

// Active tickets tracking
const activeTickets = new Map(); // userId -> channelId
const ticketClaims = new Map();  // channelId -> userId
const ticketData = new Map();    // channelId -> { type: string, creatorId: string }

const ANNOUNCEMENT_MESSAGE = `🌐 **Server Information**

🖥️ IP: \`play.paragonsmp.fun\`  
🛒 Store: https://paragonsmp.fun  
🎮 Port: 25592`;

// ================= ANNOUNCEMENT ON COMMAND =================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase().trim();
  if (["!ip", "!store", "!shop", "!port", "!info"].includes(content)) {
    await message.reply(ANNOUNCEMENT_MESSAGE).catch(() => {});
  }
});

// ================= SLASH COMMANDS =================
const commands = [
  new SlashCommandBuilder().setName("member-count").setDescription("Show member count"),
  new SlashCommandBuilder()
    .setName("p")
    .setDescription("Partnership management")
    .addSubcommand(sub => sub.setName("accept").setDescription("Accept current partnership ticket")),
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

  setInterval(() => {
    client.guilds.cache.forEach(guild => {
      const channel = guild.channels.cache.find(
        c => c.name === CHAT_CHANNEL_NAME && c.isTextBased()
      );
      if (channel) channel.send(ANNOUNCEMENT_MESSAGE).catch(() => {});
    });
  }, 30 * 60 * 1000);
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  try {

    // ========== OPEN TICKET MENU ==========
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_menu") {
      const user = interaction.user;
      if (activeTickets.has(user.id)) {
        return interaction.reply({ content: "❌ You already have an open ticket.", ephemeral: true });
      }

      const type = interaction.values[0];

      if (type === "partnership") {
        // Special modal for partnership
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_partnership`)
          .setTitle("Partnership Application");

        const ownerInput = new TextInputBuilder()
          .setCustomId("owner")
          .setLabel("Are you the owner of this server?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(ownerInput));

        return interaction.showModal(modal);
      }

      // Normal modal for other types
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

    // ========== CREATE TICKET (MODAL SUBMIT) ==========
    if (interaction.isModalSubmit()) {
      const user = interaction.user;
      const customId = interaction.customId;
      let type = "";

      if (customId.startsWith("ticket_modal_")) {
        type = customId.replace("ticket_modal_", "");
      }

      const channel = await interaction.guild.channels.create({
        name: `🎫ticket-${user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `ticket-${user.id}|${type}`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      activeTickets.set(user.id, channel.id);
      ticketData.set(channel.id, { type, creatorId: user.id });

      let embedDescription = "";

      if (type === "partnership") {
        const ownerAnswer = interaction.fields.getTextInputValue("owner");
        embedDescription = `**Are you the owner?** ${ownerAnswer}\nType: ${type}`;
      } else {
        embedDescription = `IGN: ${interaction.fields.getTextInputValue("ign") || "Not provided"}
Problem: ${interaction.fields.getTextInputValue("problem") || "Not provided"}
Extra: ${interaction.fields.getTextInputValue("extra") || "Not provided"}
Type: ${type}`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket - ${user.username}`)
        .setDescription(embedDescription)
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

      // Partnership specific messages
      if (type === "partnership") {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("📊 Partnership Questions")
              .setDescription("**1.** How many players do you have?\n**2.** Please send us your ad.")
              .setColor(0x00aaff)
          ]
        });
      }

      return interaction.reply({ content: "🎫 Ticket created successfully!", ephemeral: true });
    }

    // ========== CLAIM ==========
    if (interaction.isButton() && interaction.customId === "claim") {
      if (!STAFF_ROLES.some(r => interaction.member.roles.cache.some(x => x.name === r))) {
        return interaction.reply({ content: "❌ No permission.", ephemeral: true });
      }

      ticketClaims.set(interaction.channel.id, interaction.user.id);

      const unclaim = new ButtonBuilder()
        .setCustomId("unclaim")
        .setLabel("❌ Unclaim")
        .setStyle(ButtonStyle.Danger);

      return interaction.reply({
        embeds: [new EmbedBuilder()
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
        embeds: [new EmbedBuilder()
          .setTitle("📌 Ticket Unclaimed")
          .setDescription("This ticket is no longer claimed.")
          .setColor(0xffa500)
        ],
        components: [new ActionRowBuilder().addComponents(claim)]
      });
    }

    // ========== PARTNERSHIP ACCEPT ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "p" && interaction.options.getSubcommand() === "accept") {
      if (!STAFF_ROLES.some(r => interaction.member.roles.cache.some(x => x.name === r))) {
        return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
      }

      const channel = interaction.channel;
      if (!channel || !ticketData.has(channel.id) || ticketData.get(channel.id).type !== "partnership") {
        return interaction.reply({ content: "❌ This command can only be used in a partnership ticket.", ephemeral: true });
      }

      const data = ticketData.get(channel.id);
      const member = await interaction.guild.members.fetch(data.creatorId).catch(() => null);

      if (member) {
        await member.roles.add(PARTNERSHIP_ROLE_ID).catch(() => {});
      }

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("✅ Partnership Accepted")
          .setDescription(`Partnership has been accepted by ${interaction.user}.\n<@${data.creatorId}> has received the partnership role.`)
          .setColor(0x00ff00)
        ]
      });
    }

    // ========== CLOSE TICKET (OPEN MODAL FOR REASON) ==========
    if (interaction.isButton() && interaction.customId === "close") {
      const channel = interaction.channel;
      if (!channel || !channel.topic || !channel.topic.includes("ticket-")) {
        return interaction.reply({ content: "❌ This is not a ticket channel.", ephemeral: true });
      }

      const closeModal = new ModalBuilder()
        .setCustomId("close_ticket_modal")
        .setTitle("Close Ticket");

      const reasonInput = new TextInputBuilder()
        .setCustomId("close_reason")
        .setLabel("Reason for closing (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      closeModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      return interaction.showModal(closeModal);
    }

    // ========== CLOSE MODAL SUBMIT ==========
    if (interaction.isModalSubmit() && interaction.customId === "close_ticket_modal") {
      const channel = interaction.channel;
      if (!channel || !channel.topic) {
        return interaction.reply({ content: "❌ Error: Invalid ticket.", ephemeral: true });
      }

      const reason = interaction.fields.getTextInputValue("close_reason") || "No reason specified";
      const topicParts = channel.topic.split("|");
      const userId = topicParts[0]?.replace("ticket-", "");
      const type = topicParts[1] || "unknown";

      await interaction.reply({ content: "🔒 Closing ticket and saving transcript...", ephemeral: false });

      const messages = await channel.messages.fetch().catch(() => null);
      if (!messages) return;

      const sorted = [...messages.values()].reverse();
      const log = sorted.map(m =>
        `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || "[Embed / Attachment]"}`
      ).join("\n");

      const fileName = `ticket-${channel.id}.txt`;
      fs.writeFileSync(fileName, log || "No messages in ticket.");

      const transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID);

      if (transcriptChannel) {
        const embed = new EmbedBuilder()
          .setTitle("🎫 Ticket Closed")
          .setColor(0xff0000)
          .addFields(
            { name: "👤 Created by", value: `<@${userId}>`, inline: true },
            { name: "👮 Closed by", value: `${interaction.user.tag}`, inline: true },
            { name: "📝 Reason", value: reason, inline: false },
            { name: "📂 Category", value: type.charAt(0).toUpperCase() + type.slice(1), inline: false }
          )
          .setFooter({ text: "Ticket System" })
          .setTimestamp();

        await transcriptChannel.send({
          embeds: [embed],
          files: [fileName]
        });
      }

      // Send transcript privately to the ticket creator
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const dmEmbed = new EmbedBuilder()
            .setTitle("🎫 Your Ticket Transcript")
            .setDescription(`Your **${type}** ticket has been closed.\n**Reason:** ${reason}`)
            .setColor(0xff0000)
            .setTimestamp();

          await user.send({
            embeds: [dmEmbed],
            files: [fileName]
          });
        } catch (e) {
          console.log(`Could not DM user ${userId}`);
        }
      }

      // Cleanup
      if (userId) activeTickets.delete(userId);
      ticketData.delete(channel.id);
      ticketClaims.delete(channel.id);

      setTimeout(() => channel.delete().catch(() => {}), 3000);
    }

    // ========== MEMBER COUNT ==========
    if (interaction.isChatInputCommand() && interaction.commandName === "member-count") {
      return interaction.reply(`👥 Members: ${interaction.guild.memberCount}`);
    }

  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
    }
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
