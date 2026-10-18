import prisma from './src/prisma.js';

async function main() {
  try {
    const usersCount = await prisma.user.count();
    console.log(`Connection successful! Total users: ${usersCount}`);
  } catch (error) {
    console.error('Connection failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
