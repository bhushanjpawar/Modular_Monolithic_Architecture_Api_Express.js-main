import Container from 'typedi';
import { UpdateUserSettingsService, UpdateUserVersionService } from '@bhushanpawar/ldd';
import { CreateUserController } from './apps/features/v1/createUsers';

Container.set<UpdateUserSettingsService>(
	UpdateUserSettingsService,
	new UpdateUserSettingsService()
);
Container.set<UpdateUserVersionService>(UpdateUserVersionService, new UpdateUserVersionService());

export const userModule: Function[] = [CreateUserController];
