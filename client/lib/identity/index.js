// @flow
import { Mongo } from 'meteor/mongo'
import { PersistentMinimongo } from 'meteor/frozeman:persistent-minimongo'

import type { Entity, FormattedEntity } from './entity'
import Keybase from './keybase'
import Anon from './anon'

const Entities = new Mongo.Collection('entities', { connection: null })
new PersistentMinimongo(Entities)

const providers = {
  keybase: Keybase,
  anon: Anon,
}

const lookupAddress = async (addr: string): Object => {
  let identityProvider = null
  let data = null
  for (identityProvider of Object.keys(providers)) {
    data = await providers[identityProvider].lookupEthAddress(addr)
    if (data) break
  }
  return { identityProvider, data }
}

class Identity {
  static format(entity: Entity, replaceMe: boolean = true): FormattedEntity {
    const formatted = providers[entity.identityProvider].format(entity)
    formatted.identityProvider = entity.identityProvider
    formatted.ethereumAddress = entity.ethereumAddress

    if (entity.ethereumAddress === Identity.current(true).ethereumAddress && replaceMe) {
      formatted.name = 'Me'
    }

    return formatted
  }

  static async getRaw(addr: string) {
    let entity = Entities.findOne({ ethereumAddress: addr })

    if (!entity) {
      const { identityProvider, data } = await lookupAddress(addr)
      if (identityProvider && data) {
        Identity.set(addr, identityProvider, data)
        entity = Entities.findOne({ ethereumAddress: addr })
      }
    }

    return entity
  }

  static async get(addr: string) {
    const entity = await Identity.getRaw(addr)
    return Identity.format(entity)
  }

  static async getUsernameRaw(username: string, identityProvider: string):
    Promise<Entity> {
    // Usually we will want to store addr => username but not the other way around
    // let entity = Entities.findOne(({'data.basics.username': username})
    const ethereumAddress = await providers[identityProvider].getVerifiedEthereumAddress(username)
    const data = await providers[identityProvider].lookup(username)
    Identity.set(ethereumAddress, identityProvider, data)

    const entity: Entity = {
      identityProvider,
      ethereumAddress,
      data,
    }

    return entity
  }

  static async getUsername(username: string, identityProvider: string):
    Promise<FormattedEntity> {
    const entity = await Identity.getUsernameRaw(username, identityProvider)
    return Identity.format(entity)
  }

  static set(addr: string, identityProvider: string, entityObj: Object) {
    const entity: Entity = {
      ethereumAddress: addr,
      identityProvider,
      data: entityObj,
    }
    Entities.upsert({ ethereumAddress: addr }, entity)
  }

  static setCurrent(entity: Entity) {
    Entities.update({ current: true }, { $unset: { current: '' } })
    Entities.update({ ethereumAddress: entity.ethereumAddress },
      { current: true, ...entity })
  }

  static setCurrentEthereumAccount(addr: string) {
    Entities.remove({ ethereumAddress: addr })
    Entities.update({ current: true }, { $set: { ethereumAddress: addr } })
  }

  static current(raw: boolean = false, replaceMe: boolean = true) {
    let entity = Entities.findOne({ current: true })

    if (!raw) entity = Identity.format(entity, replaceMe)
    return entity
  }

  static async linkCurrent(identityProvider: string): Promise<boolean> {
    const current = Identity.current()

    const username = await providers[identityProvider].link(current.ethereumAddress)
    if (!username) return false

    const entity = await Identity.getUsernameRaw(username, identityProvider)
    Identity.setCurrent(entity)

    return true
  }
}

export default Identity
