import {
	GetUserRowVersionService,
	IGetVersionByIdentifierServiceResult,
	QueryRunner,
	StatusEnum,
	UserEntity,
} from '@kishornaik/mma_db';
import { IUsers } from '../types';
import { IServiceHandlerAsync } from '@/shared/utils/helpers/services';
import Container, { Service } from 'typedi';
import { ResultError, ResultExceptionFactory } from '@/shared/utils/exceptions/results';
import { Ok, Result } from 'neverthrow';
import { StatusCodes } from 'http-status-codes';
import { redisCacheCircuitBreaker, RedisHelper } from '@/shared/utils/helpers/redis';
import medaitR from '@/shared/medaitR';
import { DataResponse } from '@/shared/models/response/data.Response';
import {
	GetUserByIdentifierDomainEventRequestDto,
	GetUserByIdentifierDomainEventResponseDto,
} from '../../apps/features/v1/getUsersByIdentifier/contracts/Index';
import { logConstruct, logger } from '@/shared/utils/helpers/loggers';
import { sealed } from '@/shared/utils/decorators/sealed';
import { GetUserByIdentifierDomainEventService } from '../../apps/features/v1/getUsersByIdentifier/events/domain/getUserByIdentifier';

Container.set<GetUserRowVersionService>(GetUserRowVersionService, new GetUserRowVersionService());

export interface IUserSharedCacheServiceParameters {
	identifier: string;
	status: StatusEnum;
	queryRunner: QueryRunner;
}

export interface IUserSharedCacheServiceResult {
	isCached: boolean;
	users: IUsers;
}

export interface IUserSharedCacheService
	extends IServiceHandlerAsync<
		IUserSharedCacheServiceParameters,
		IUserSharedCacheServiceResult
	> {}

@sealed
@Service()
export class UserSharedCacheService implements IUserSharedCacheService {
	private readonly _getUserRowVersionService: GetUserRowVersionService;
	private readonly _userSetCacheService: UserSetCacheService;
	private readonly _redisHelper: RedisHelper;

	public constructor() {
		this._getUserRowVersionService = Container.get(GetUserRowVersionService);
		this._userSetCacheService = Container.get(UserSetCacheService);
		this._redisHelper = Container.get(RedisHelper);
	}

	public async handleAsync(
		params: IUserSharedCacheServiceParameters
	): Promise<Result<IUserSharedCacheServiceResult, ResultError>> {
		try {
			//@Guard
			if (!params)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid params');

			if (!params.identifier)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid identifier');

			if (params.status === null)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid status');

			if (!params.queryRunner)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'invalid queryRunner');

			const { identifier, status, queryRunner } = params;

			// init Redis Cache
			await this._redisHelper.init(true);

			const cacheKey = `users_${identifier}`;
			const cacheValueResult = await this._redisHelper.get(cacheKey);
			// const cacheValueResult = await redisCacheCircuitBreaker.fire(
			// 	this._redisHelper,
			// 	cacheKey
			// );

			if (cacheValueResult.isErr())
				return ResultExceptionFactory.error(
					cacheValueResult.error.status,
					cacheValueResult.error.message
				);

			//const cacheValue: string = cacheValueResult;
			const cacheValue: string = cacheValueResult.value;
			if (!cacheValue) {
				// Get User Data By Identifier
				const userSetCacheServiceResult = await this._userSetCacheService.handleAsync({
					identifier: identifier,
					status: status,
					primaryCacheName: cacheKey,
					isCached: true,
					queryRunner: queryRunner,
				});
				if (userSetCacheServiceResult.isErr())
					return ResultExceptionFactory.error(
						userSetCacheServiceResult.error.status,
						userSetCacheServiceResult.error.message
					);

				return new Ok(userSetCacheServiceResult.value);
			} else {
				const user: IUsers = JSON.parse(cacheValue);
				if (!user)
					return ResultExceptionFactory.error(StatusCodes.NOT_FOUND, 'user not found');

				// Get User Row Version
				const userEntity: UserEntity = new UserEntity();
				userEntity.identifier = identifier;
				userEntity.status = status;

				const userRowVersionServiceResult =
					await this._getUserRowVersionService.handleAsync(userEntity, queryRunner);
				if (userRowVersionServiceResult.isErr())
					return ResultExceptionFactory.error(
						userRowVersionServiceResult.error.statusCode,
						userRowVersionServiceResult.error.message
					);

				const userRowVersionResult: IGetVersionByIdentifierServiceResult =
					userRowVersionServiceResult.value;

				if (userRowVersionResult.version !== user.version) {
					// Get User Data By Identifier
					const userSetCacheServiceResult = await this._userSetCacheService.handleAsync({
						identifier: identifier,
						status: status,
						primaryCacheName: cacheKey,
						isCached: true,
						queryRunner: queryRunner,
					});
					if (userSetCacheServiceResult.isErr())
						return ResultExceptionFactory.error(
							userSetCacheServiceResult.error.status,
							userSetCacheServiceResult.error.message
						);

					return new Ok(userSetCacheServiceResult.value);
				} else {
					const result: IUserSharedCacheServiceResult = {
						isCached: false,
						users: user,
					};
					return new Ok(result);
				}
			}
		} catch (ex) {
			const error = ex as Error;
			return ResultExceptionFactory.error(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
		} finally {
			await this._redisHelper.disconnect();
		}
	}
}

interface IGetUserByIdentifierDataServiceParameters {
	identifier: string;
	status: StatusEnum;
	queryRunner: QueryRunner;
	isCached?: boolean;
}

interface IGetUserByIdentifierDataService
	extends IServiceHandlerAsync<
		IGetUserByIdentifierDataServiceParameters,
		IUserSharedCacheServiceResult
	> {}

@sealed
@Service()
class GetUserByIdentifierDataService implements IGetUserByIdentifierDataService {
	private readonly _getUserByIdentifierDomainEventService: GetUserByIdentifierDomainEventService;

	public constructor() {
		this._getUserByIdentifierDomainEventService = Container.get(
			GetUserByIdentifierDomainEventService
		);
	}

	public async handleAsync(
		params: IGetUserByIdentifierDataServiceParameters
	): Promise<Result<IUserSharedCacheServiceResult, ResultError>> {
		let isCached: boolean = false;
		try {
			//@Guard
			if (!params)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid params');

			if (!params.identifier)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid identifier');

			if (params.status === null)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid status');

			if (!params.queryRunner)
				return ResultExceptionFactory.error(
					StatusCodes.BAD_REQUEST,
					'Invalid query Runner'
				);

			// Get users data
			const getUserByIdentifierDomainEventRequestDto: GetUserByIdentifierDomainEventRequestDto =
				new GetUserByIdentifierDomainEventRequestDto();
			getUserByIdentifierDomainEventRequestDto.identifier = params.identifier;
			getUserByIdentifierDomainEventRequestDto.status = params.status;

			const getUserByIdentifierDomainEventResult =
				await this._getUserByIdentifierDomainEventService.handleAsync({
					request: getUserByIdentifierDomainEventRequestDto,
					queryRunner: params.queryRunner,
				});
			if (getUserByIdentifierDomainEventResult.isErr())
				return ResultExceptionFactory.error(
					getUserByIdentifierDomainEventResult.error.status,
					getUserByIdentifierDomainEventResult.error.message
				);

			const users: IUsers = getUserByIdentifierDomainEventResult.value.user;

			const result: IUserSharedCacheServiceResult = {
				isCached: isCached,
				users: users,
			};

			return new Ok(result);
		} catch (ex) {
			const error = ex as Error;
			return ResultExceptionFactory.error(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
		}
	}
}

interface IUserSetCacheServiceParameters {
	identifier: string;
	status: StatusEnum;
	primaryCacheName: string;
	queryRunner: QueryRunner;
	isCached?: boolean;
}

interface IUserSetCacheService
	extends IServiceHandlerAsync<IUserSetCacheServiceParameters, IUserSharedCacheServiceResult> {}

@sealed
@Service()
class UserSetCacheService implements IUserSetCacheService {
	private readonly _getUserByIdentifierDataService: GetUserByIdentifierDataService;
	private readonly _redisHelper: RedisHelper;

	public constructor() {
		this._getUserByIdentifierDataService = Container.get(GetUserByIdentifierDataService);
		this._redisHelper = Container.get(RedisHelper);
	}

	public async handleAsync(
		params: IUserSetCacheServiceParameters
	): Promise<Result<IUserSharedCacheServiceResult, ResultError>> {
		try {
			//@Guard
			if (!params)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid params');

			if (!params.identifier)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid identifier');

			if (params.status === null)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid status');

			if (!params.primaryCacheName)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid cache name');

			if (!params.queryRunner)
				return ResultExceptionFactory.error(StatusCodes.BAD_REQUEST, 'Invalid queryRunner');

			const { identifier, status, primaryCacheName, queryRunner } = params;

			// Get User Data By Identifier
			const getUserByIdentifierDataServiceResult =
				await this._getUserByIdentifierDataService.handleAsync({
					identifier: identifier,
					status: status,
					isCached: false,
					queryRunner: queryRunner,
				});
			if (getUserByIdentifierDataServiceResult.isErr())
				return ResultExceptionFactory.error(
					getUserByIdentifierDataServiceResult.error.status,
					getUserByIdentifierDataServiceResult.error.message
				);

			const users: IUsers = getUserByIdentifierDataServiceResult.value.users;

			// Set Cache
			const setCacheIdentifierResult = await this._redisHelper.set(
				primaryCacheName,
				JSON.stringify(users)
			);
			if (setCacheIdentifierResult.isErr()) {
				logger.error(
					logConstruct(
						'UserSharedCacheService',
						'handleAsync',
						setCacheIdentifierResult.error.message
					)
				);
				return getUserByIdentifierDataServiceResult;
			}

			const setCacheClientIdResult = await this._redisHelper.set(
				`users_clientId_${users.clientId}`,
				JSON.stringify(users)
			);
			if (setCacheClientIdResult.isErr()) {
				logger.error(
					logConstruct(
						'UserSharedCacheService',
						'handleAsync',
						setCacheClientIdResult.error.message
					)
				);
				return getUserByIdentifierDataServiceResult;
			}

			const setCacheEmailResult = await this._redisHelper.set(
				`users_email_${users.communication.email}`,
				JSON.stringify(users)
			);
			if (setCacheEmailResult.isErr()) {
				logger.error(
					logConstruct(
						'UserSharedCacheService',
						'handleAsync',
						setCacheEmailResult.error.message
					)
				);
				return getUserByIdentifierDataServiceResult;
			}

			const result: IUserSharedCacheServiceResult = {
				isCached: true,
				users: users,
			};
			return new Ok(result);
		} catch (ex) {
			const error = ex as Error;
			return ResultExceptionFactory.error(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
		}
	}
}
