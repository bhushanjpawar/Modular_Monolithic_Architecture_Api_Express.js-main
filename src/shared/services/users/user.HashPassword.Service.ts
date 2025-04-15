import { saltRounds } from '@/shared/models/constant/index';
import { ResultError, ResultExceptionFactory } from '@/shared/utils/exceptions/results';
import * as bcrypt from 'bcrypt';
import { StatusCodes } from 'http-status-codes';
import { Err, Ok, Result } from 'neverthrow';
import { Service } from 'typedi';

export interface IHashPasswordResult {
	hash: string;
	salt: string;
}

export interface IHashPasswordService {
	hashPasswordAsync(password: string): Promise<Result<IHashPasswordResult, ResultError>>;
	comparePasswordAsync(
		password: string,
		hashedPassword: string
	): Promise<Result<boolean, ResultError>>;
}

@Service()
export class HashPasswordService implements IHashPasswordService {
	public async hashPasswordAsync(
		password: string
	): Promise<Result<IHashPasswordResult, ResultError>> {
		try {
			const salt = await bcrypt.genSalt();
			const hashedPassword = await bcrypt.hash(password, salt ?? saltRounds);

			if (!hashedPassword)
				return new Err(
					new ResultError(
						StatusCodes.INTERNAL_SERVER_ERROR,
						'Error while hashing password'
					)
				);

			const result: IHashPasswordResult = {
				hash: hashedPassword,
				salt: salt,
			};

			return new Ok(result); // hashedPassword;
		} catch (ex) {
			return ResultExceptionFactory.error(StatusCodes.INTERNAL_SERVER_ERROR, ex.message);
		}
	}

	public async comparePasswordAsync(
		password: string,
		hashedPassword: string
	): Promise<Result<boolean, ResultError>> {
		try {
			const match = await bcrypt.compare(password, hashedPassword);

			if (!match)
				return new Err(
					new ResultError(
						StatusCodes.INTERNAL_SERVER_ERROR,
						'Error while comparing password'
					)
				);

			return new Ok(match); // match;
		} catch (ex) {
			return ResultExceptionFactory.error(StatusCodes.INTERNAL_SERVER_ERROR, ex.message);
		}
	}
}
