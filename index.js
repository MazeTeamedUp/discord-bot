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
const express = require("express");

const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(3000, () => console.log("Keep-alive server running"));

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= CONFIG =================
const PANEL_CHANNEL_ID = "1411760024363204800";
const TICKET_CATEGORY_ID = "1456670139486572818";
const TRANSCRIPT_CHANNEL_ID = "1456670136491704414";

const PARTNER_ROLE_ID = "1462436008372080745";

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

const activeTickets = new Map();
const ticketClaims = new Map();

// ================= ANNOUNCEMENT =================
const ANNOUNCEMENT_MESSAGE = `🌐 **Server Information**

🖥️ IP: \`play.paragonsmp.fun\`  
🛒 Store: https://paragonsmp.fun  
🎮 Port: 25592`;

// ================= READY ANNOUNCEMENT COMMAND TRIGGERS =================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const triggers = ["!ip", "!store", "!shop", "!port", "!info"];

  if (triggers.includes(message.content.toLowerCase())) {
    message.channel.send(ANNOUNCEMENT_MESSAGE);
  }
});

// ================= SLASH COMMANDS =================
const commands = [
  new SlashCommandBuilder().setName("member-count").setDescription("Show member count"),
  new SlashCommandBuilder().setName("close").setDescription("Close ticket (inside ticket only)"),
  new SlashCommandBuilder().setName("p").setDescription("Partnership commands")
    .addSubcommand(s => s.setName("accept").setDescription("Accept partnership"))
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
    .setDescription(`Select a category below.`);

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

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {

  try {

    // ================= PARTNERSHIP SPECIAL START =================
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_menu") {

      const type = interaction.values[0];

      if (activeTickets.has(interaction.user.id)) {
        return interaction.reply({ content: "❌ You already have a ticket.", ephemeral: true });
      }

      // PARTNERSHIP SPECIAL QUESTION FIRST
      if (type === "partnership") {

        const modal = new ModalBuilder()
          .setCustomId("partnership_owner_check")
          .setTitle("Partnership Setup");

        const owner = new TextInputBuilder()
          .setCustomId("owner")
          .setLabel("Are you the owner of this server?")
          .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(owner));

        return interaction.showModal(modal);
      }

      // NORMAL TICKETS
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

    // ================= PARTNERSHIP MODAL =================
    if (interaction.isModalSubmit() && interaction.customId === "partnership_owner_check") {

      const ownerAnswer = interaction.fields.getTextInputValue("owner");

      const channel = await interaction.guild.channels.create({
        name: `🤝partner-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `ticket-${interaction.user.id}|partnership`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      activeTickets.set(interaction.user.id, channel.id);

      await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [
          new EmbedBuilder()
            .setTitle("🤝 Partnership Ticket")
            .setDescription(`Owner? ${ownerAnswer}`)
            .setColor(0x00aaff)
        ]
      });

      // partnership questions inside ticket
      await channel.send("1️⃣ How many players do you have?");
      await channel.send("2️⃣ Please send us your ad.");

      return interaction.reply({ content: "🤝 Partnership ticket created!", ephemeral: true });
    }

    // ================= NORMAL TICKETS =================
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
        .setCustomId("claim")
        .setLabel("📌 Claim")
        .setStyle(ButtonStyle.Primary);

      const closeBtn = new ButtonBuilder()
        .setCustomId("close")
        .setLabel("❌ Close")
        .setStyle(ButtonStyle.Danger);

      await channel.send({
        content: `<@${user.id}>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(claimBtn, closeBtn)]
      });

      return interaction.reply({ content: "🎫 Ticket created!", ephemeral: true });
    }

    // ================= /p accept =================
    if (interaction.isChatInputCommand() && interaction.commandName === "p") {

      if (!interaction.member.roles.cache.some(r => STAFF_ROLES.includes(r.name))) {
        return interaction.reply({ content: "❌ No permission", ephemeral: true });
      }

      if (interaction.options.getSubcommand() === "accept") {

        const member = interaction.guild.members.cache.get(
          interaction.channel.topic?.split("|")[0]?.replace("ticket-", "")
        );

        if (member) await member.roles.add(PARTNER_ROLE_ID);

        await interaction.reply("✅ Partnership accepted!");

        interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🤝 Partnership Accepted")
              .setDescription(`Accepted by ${interaction.user}`)
              .setColor(0x00ff00)
          ]
        });
      }
    }

    // ================= CLOSE (MODAL REASON) =================
    if (interaction.isButton() && interaction.customId === "close") {

      const modal = new ModalBuilder()
        .setCustomId("close_reason")
        .setTitle("Close Ticket");

      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(new ActionRowBuilder().addComponents(reason));

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "close_reason") {

      const channel = interaction.channel;

      const reason = interaction.fields.getTextInputValue("reason") || "No reason specified";

      const messages = await channel.messages.fetch();
      const sorted = [...messages.values()].reverse();

      const log = sorted.map(m =>
        `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`
      ).join("\n");

      const file = `ticket-${channel.id}.txt`;
      fs.writeFileSync(file, log);

      const topic = channel.topic?.split("|")?.[1] || "unknown";
      const userId = channel.topic?.split("|")?.[0]?.replace("ticket-", "");

      const embed = new EmbedBuilder()
        .setTitle("🎫 Ticket Closed")
        .addFields(
          { name: "Reason", value: reason },
          { name: "Category", value: topic }
        )
        .setColor(0xff0000);

      const transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID);
      if (transcriptChannel) {
        transcriptChannel.send({ embeds: [embed], files: [file] });
      }

      // DM user transcript
      if (userId) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          user.send({ embeds: [embed], files: [file] }).catch(() => {});
        }
        activeTickets.delete(userId);
      }

      await interaction.reply("🔒 Closing ticket...");
      setTimeout(() => channel.delete().catch(() => {}), 2000);
    }

    // ================= MEMBER COUNT =================
    if (interaction.isChatInputCommand() && interaction.commandName === "member-count") {
      return interaction.reply(`👥 Members: ${interaction.guild.memberCount}`);
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
