import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import DetailedMatch, { DetailedMatchModel } from 'App/Models/DetailedMatch'
import { ParticipantDetails } from 'App/Models/Match'
import Summoner from 'App/Models/Summoner'
import Jax from 'App/Services/Jax'
import MatchService from 'App/Services/MatchService'
import StatsService from 'App/Services/StatsService'
import SummonerService from 'App/Services/SummonerService'
import DetailedMatchTransformer from 'App/Transformers/DetailedMatchTransformer'
import DetailedMatchValidator from 'App/Validators/DetailedMatchValidator'
import MatchesIndexValidator from 'App/Validators/MatchesIndexValidator'

export default class MatchesController {
  /**
   * Get the soloQ rank of all the players of the team
   * @param summoner all the data of the summoner
   * @param region of the match
   */
  private async getPlayerRank (summoner: ParticipantDetails, region: string) {
    const account = await Jax.Summoner.summonerId(summoner.summonerId, region)
    if (account) {
      const ranked = await SummonerService.getRanked(account, region)
      summoner.rank = ranked.soloQ ? (({ tier, shortName }) => ({ tier, shortName }))(ranked.soloQ) : null
    } else {
      summoner.rank = null
    }

    return summoner
  }

  /**
   * POST - Return data from matches searched by gameIds
   * @param ctx 
   */
  public async index ({ request, response }: HttpContextContract) {
    console.log('More Matches Request')
    const { puuid, accountId, region, gameIds, season } = await request.validate(MatchesIndexValidator)

    const summonerDB = await Summoner.findOne({ puuid })
    if (!summonerDB) {
      return response.json(null)
    }

    const matchesId = /^\d/.test(gameIds[0]) ? gameIds.map(id => `${region.toUpperCase()}_${id}`) : gameIds
    const matches = await MatchService.getMatches(puuid, accountId, region, matchesId, summonerDB)

    await summonerDB.save()

    const stats = await StatsService.getSummonerStats(puuid, season)

    return response.json({
      matches,
      stats,
    })
  }

  /**
   * POST - Return details data for one specific match
   * @param ctx 
   */
  public async show ({ request, response }: HttpContextContract) {
    console.time('MatchDetails')
    const { gameId, region } = await request.validate(DetailedMatchValidator)

    let matchDetails: DetailedMatchModel
    const alreadySaved = await DetailedMatch.findOne({ gameId, region })

    if (alreadySaved) {
      console.log('MATCH DETAILS ALREADY SAVED')
      matchDetails = alreadySaved
    } else {
      const matchId = `${region.toUpperCase()}_${gameId}`
      const match = await Jax.Match.get(matchId, region)
      matchDetails = await DetailedMatchTransformer.transform(match)
      await DetailedMatch.create(matchDetails)
    }

    console.timeEnd('MatchDetails')

    return response.json({
      matchDetails,
    })
  }

  /**
   * POST - Return ranks of players for a specific game
   * @param ctx 
   */
  public async showRanks ({ request, response }: HttpContextContract) {
    console.time('Ranks')
    const { gameId, region } = await request.validate(DetailedMatchValidator)

    let matchDetails = await DetailedMatch.findOne({ gameId, region })

    if (!matchDetails) {
      return response.json(null)
    }

    const requestsBlue = matchDetails.blueTeam.players.map(p => this.getPlayerRank(p, region))
    matchDetails.blueTeam.players = await Promise.all(requestsBlue)

    const requestsRed = matchDetails.redTeam.players.map(p => this.getPlayerRank(p, region))
    matchDetails.redTeam.players = await Promise.all(requestsRed)

    matchDetails.save()
    console.timeEnd('Ranks')

    return response.json({
      blueTeam: matchDetails.blueTeam.players,
      redTeam: matchDetails.redTeam.players,
    })
  }
}
