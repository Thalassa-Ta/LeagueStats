import Jax from './Jax'
import { MatchlistDto } from './Jax/src/Endpoints/MatchlistEndpoint'
import { SummonerDTO } from './Jax/src/Endpoints/SummonerEndpoint'
import Summoner from 'App/Models/Summoner'
import Database from '@ioc:Adonis/Lucid/Database'
import SummonerMatchlist from 'App/Models/SummonerMatchlist'
import MatchParser from 'App/Parsers/MatchParser'

class MatchService {
  /**
   * Add 100 matches at a time to MatchList until the stopFetching condition is true
   * @param account of the summoner
   * @param stopFetching condition to stop fetching the MatchList
   */
  private async _fetchMatchListUntil(account: SummonerDTO, stopFetching: any) {
    let matchList: MatchlistDto = []
    let alreadyIn = false
    let index = 0
    do {
      let newMatchList = await Jax.Matchlist.puuid(account.puuid, account.region as string, index)
      // Error while fetching Riot API
      if (!newMatchList) {
        return matchList
      }
      matchList = [...matchList, ...newMatchList]
      alreadyIn = newMatchList.length === 0 || stopFetching(newMatchList)
      // If the match is made in another region : we stop fetching
      if (
        matchList[matchList.length - 1].split('_')[0].toLowerCase() !==
        account.region?.toLowerCase()
      ) {
        alreadyIn = true
      }
      index += 100
    } while (!alreadyIn)
    return matchList
  }
  /**
   * Update the full MatchList of the summoner
   */
  public async updateMatchList(account: SummonerDTO, summonerDB: Summoner): Promise<MatchlistDto> {
    console.time('matchList')

    const currentMatchList = await summonerDB
      .related('matchList')
      .query()
      .orderBy('matchId', 'desc')
    const currentMatchListIds = currentMatchList.map((m) => m.matchId)

    const newMatchList = await this._fetchMatchListUntil(account, (newMatchList: MatchlistDto) => {
      return currentMatchListIds.some((id) => id === newMatchList[newMatchList.length - 1])
    })

    const matchListToSave: MatchlistDto = []
    for (const matchId of newMatchList.reverse()) {
      if (!currentMatchListIds.some((id) => id === matchId)) {
        matchListToSave.push(matchId)
        currentMatchListIds.push(matchId)
      }
    }

    // If there is new matchIds to save in database
    if (matchListToSave.length) {
      await Database.table('summoner_matchlist').multiInsert(
        matchListToSave.map((id) => ({
          match_id: id,
          summoner_puuid: summonerDB.puuid,
        }))
      )
    }

    console.timeEnd('matchList')
    return currentMatchListIds
  }

  /**
   * Fetch list of matches for a specific Summoner
   */
  public async getMatches(region: string, matchList: SummonerMatchlist[], summonerDB: Summoner) {
    console.time('getMatches')

    let matches: any[] = [] // Todo: add type of serialized matches here
    const matchesToGetFromRiot: MatchlistDto = []
    for (let i = 0; i < matchList.length; ++i) {
      const matchSaved = await summonerDB
        .related('matches')
        .query()
        .where('matchId', matchList[i].matchId)
        .preload('match')
        .first()

      if (matchSaved) {
        // TODO: Serialize match from DB + put it in Redis + push it in "matches"
      } else {
        matchesToGetFromRiot.push(matchList[i].matchId)
      }
    }

    const requests = matchesToGetFromRiot.map((gameId) => Jax.Match.get(gameId, region))
    const matchesFromApi = await Promise.all(requests)

    /* If we have to store some matches in the db */
    if (matchesFromApi.length !== 0) {
      // Transform raw matches data
      const parsedMatches = await MatchParser.parse(matchesFromApi)

      // TODO: Serialize match from DB + put it in Redis + push it in "matches"
    }

    // Todo: Sort and return "matches"

    console.timeEnd('getMatches')
  }
}

export default new MatchService()