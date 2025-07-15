import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import appConfig from '../../../config/app.config';
import { UserService } from 'src/modules/admin/user/user.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly userService: UserService) {
    super({
      clientID: appConfig().auth.google.app_id,
      clientSecret: appConfig().auth.google.app_secret,
      callbackURL: appConfig().auth.google.callback,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    try {
      const { name, emails, photos, id } = profile;
      const email = emails[0].value;

      let user = await this.userService.findByEmail(email);

      if (!user) {
        // Create new user with Google data
        user = await this.userService.createWithGoogle({
          email,
          first_name: name.givenName,
          last_name: name.familyName,
          avatar: photos[0].value,
        });

        // Create OAuth account record
        await this.userService.createOAuthAccount({
          userId: user.id,
          provider: 'google',
          providerAccountId: id,
          accessToken,
          refreshToken,
        });
      } else {
        // Update existing user's OAuth account or create new one
        await this.userService.updateOrCreateOAuthAccount({
          userId: user.id,
          provider: 'google',
          providerAccountId: id,
          accessToken,
          refreshToken,
        });
      }

      done(null, user);
    } catch (error) {
      done(error, false);
    }
  }
}
