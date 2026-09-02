FROM postgres:17-alpine
RUN apk add --no-cache restic tzdata
COPY backup.sh /usr/local/bin/backup.sh
COPY crontab /etc/crontabs/root
RUN chmod 0755 /usr/local/bin/backup.sh
CMD ["crond", "-f", "-l", "2"]