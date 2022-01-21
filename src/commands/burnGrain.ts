import { SlashCommandBuilder } from '@discordjs/builders'
import {
  CommandInteraction,
  MessageAttachment,
  MessageActionRow,
  MessageButton,
  MessageComponentInteraction,
} from 'discord.js'
import { readFileSync, statSync } from 'fs'

import { formatGrainBurnList } from '../utils/helpers'
import { getLedgerManager, burnGrain } from '../utils/sourcecred'

const SOURCECRED_ADMINS = process.env.SOURCECRED_ADMINS?.split(', ') || []

export default {
  data: new SlashCommandBuilder()
    .setName('burn-grain')
    .setDescription(
      'Admin only command: Burns users grain by transferring it to the Dai Redemptions account'
    )
    .addStringOption((option) =>
      option
        .setName('branch-name')
        .setDescription('GitHub branch name created on the /sc-onboard command')
        .setRequired(true)
    ),
  async execute(interaction: CommandInteraction) {
    try {
      if (!SOURCECRED_ADMINS.includes(interaction.user.id)) {
        await interaction.reply({
          content: 'Error: admin-only command',
          ephemeral: true,
        })
        return
      }
      await interaction.deferReply()

      const row = new MessageActionRow().addComponents(
        new MessageButton()
          .setCustomId('confirm')
          .setLabel('Yes')
          .setStyle('SUCCESS'),
        new MessageButton()
          .setCustomId('reject')
          .setLabel('No')
          .setStyle('DANGER')
      )

      const paymentsBuffer = readFileSync('./payments.txt')

      await interaction.editReply({
        content: `Found this distribution file from ${
          statSync('./payments.txt').mtime
        }. Are these the amounts that should be burned?`,
        files: [new MessageAttachment(paymentsBuffer, 'payments.txt')],
        components: [row],
      })

      if (!interaction.channel)
        throw 'There was an error fetching the Discord channel'
      const filter = (i: MessageComponentInteraction) =>
        (i.customId === 'confirm' || i.customId === 'reject') &&
        i.user.id === interaction.user.id
      const collector = interaction.channel.createMessageComponentCollector({
        filter,
        time: 900000,
        max: 1,
      })
      collector.on('collect', async (i) => {
        await i.update({ components: [] })

        if (i.customId === 'reject') {
          await i.followUp(
            'Command canceled by the user. If the distribution file is not up to date, try running the `/sc-payments-csv` command again to generate a new file based on the latest grain distribution.'
          )
        } else {
          await i.followUp('Transferring grain for users, please wait...')

          const branchName = interaction.options.getString('branch-name', true)
          const ledgerManager = await getLedgerManager(branchName)
          const grainBurnList = formatGrainBurnList(paymentsBuffer)
          await burnGrain(ledgerManager, grainBurnList)

          await i.followUp(
            `Grain succesfully transferred to the Dai Redemptions account for users on branch \`${branchName}\``
          )
        }
      })
    } catch (err) {
      console.log(err)
      if (typeof err === 'string') interaction.editReply(err)
      else
        interaction.editReply(
          'There was an error trying to transfer grain for users, please try again'
        )
    }
  },
}
