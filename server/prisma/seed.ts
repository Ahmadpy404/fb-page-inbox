import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial auto-reply rules and settings...');

  // Default global setting
  await prisma.setting.upsert({
    where: { key: 'global_auto_reply' },
    update: {},
    create: {
      key: 'global_auto_reply',
      value: 'true',
    },
  });

  // Seed sample rules if none exist
  const existingRulesCount = await prisma.rule.count();
  if (existingRulesCount === 0) {
    await prisma.rule.createMany({
      data: [
        {
          keyword: 'pricing',
          matchType: 'contains',
          replyText: '👋 Hi! Our pricing plans start at $49/month. You can view all features on our website or reply with your specific requirements!',
          priority: 0,
          enabled: true,
        },
        {
          keyword: 'hours',
          matchType: 'contains',
          replyText: '🕒 Our team is available Monday - Friday, 9:00 AM to 6:00 PM EST. Messages outside these hours are queued and answered promptly!',
          priority: 1,
          enabled: true,
        },
        {
          keyword: 'support',
          matchType: 'contains',
          replyText: '🛠️ Need help? Please describe the issue you are experiencing, and our support team will assist you right away.',
          priority: 2,
          enabled: true,
        },
        {
          keyword: '^(hi|hello|hey)$',
          matchType: 'regex',
          replyText: '👋 Hello! Welcome to our Facebook Page. How can we help you today?',
          priority: 3,
          enabled: true,
        },
      ],
    });
    console.log('Created 4 default auto-reply rules.');
  }

  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
