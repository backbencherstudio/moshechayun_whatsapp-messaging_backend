import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyFunction } from 'passport-facebook';
import appConfig from '../../../config/app.config';
import { UserService } from 'src/modules/admin/user/user.service';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
    constructor(private readonly userService: UserService) {
        super({
            clientID: appConfig().auth.facebook.app_id,
            clientSecret: appConfig().auth.facebook.app_secret,
            callbackURL: appConfig().auth.facebook.callback,
            profileFields: ['id', 'emails', 'name', 'photos'],
            scope: ['email'],
        });
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
    ): Promise<any> {
        try {
            const { id, emails, name, photos } = profile;
            const email = emails?.[0]?.value;

            if (!email) {
                throw new Error('Email is required for Facebook login');
            }

            let user = await this.userService.findByEmail(email);

            if (!user) {
                // Create new user with Facebook data
                user = await this.userService.createWithOAuth({
                    email,
                    first_name: name?.givenName,
                    last_name: name?.familyName,
                    avatar: photos?.[0]?.value,
                });

                // Create OAuth account record
                await this.userService.createOAuthAccount({
                    userId: user.id,
                    provider: 'facebook',
                    providerAccountId: id,
                    accessToken,
                    refreshToken,
                });
            } else {
                // Update existing user's OAuth account or create new one
                await this.userService.updateOrCreateOAuthAccount({
                    userId: user.id,
                    provider: 'facebook',
                    providerAccountId: id,
                    accessToken,
                    refreshToken,
                });
            }

            return user;
        } catch (error) {
            throw error;
        }
    }
}
